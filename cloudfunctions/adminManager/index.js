const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const usersCollection = db.collection('users');
const settingsCollection = db.collection('settings');

const DEFAULT_POOLS = ['前期', '后期', '主持', '写作'];

async function getValidPools() {
  const configRes = await settingsCollection.doc('global_config').get().catch(() => ({ data: {} }));
  const pools = (configRes.data && Array.isArray(configRes.data.poolOptions)) ? configRes.data.poolOptions : [];
  const cleanedPools = pools
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return cleanedPools.length > 0 ? cleanedPools : DEFAULT_POOLS;
}

exports.main = async (event, context) => {
  if (event.action === 'getDashboardData') {
    try {
      const configRes = await settingsCollection.doc('global_config').get().catch(() => ({ data: {} }));
      const usersRes = await usersCollection.get();
      const regsRes = await db.collection('registrations').get().catch(() => ({ data: [] }));

      const regMap = new Map();
      regsRes.data.forEach(item => {
        regMap.set(item.codeName, item.poolType || '未分组');
      });

      const usersWithRegStatus = usersRes.data.map(user => ({
        ...user,
        hasRegistered: regMap.has(user.codeName),
        registrationPool: regMap.get(user.codeName) || ''
      }));

      const config = configRes.data || {};
      if (!Array.isArray(config.poolOptions) || config.poolOptions.length === 0) {
        config.poolOptions = DEFAULT_POOLS;
      }
      return { success: true, config, users: usersWithRegStatus };
    } catch (err) {
      return { success: false, msg: '获取数据失败: ' + err.message };
    }
  }

  if (event.action === 'saveTimeConfig') {
    try {
      const checkRes = await settingsCollection.where({ _id: 'global_config' }).count();
      if (checkRes.total === 0) {
        await settingsCollection.add({
          data: { _id: 'global_config', startTime: event.startTime, endTime: event.endTime }
        });
      } else {
        await settingsCollection.doc('global_config').update({
          data: { startTime: event.startTime, endTime: event.endTime }
        });
      }
      return { success: true };
    } catch (err) {
      return { success: false, msg: err.message || '数据库写入时间异常' };
    }
  }

  if (event.action === 'savePoolConfig') {
    try {
      const incomingPools = Array.isArray(event.poolOptions) ? event.poolOptions : [];
      const cleanedPools = [...new Set(incomingPools
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean))];

      if (cleanedPools.length === 0) {
        return { success: false, msg: '请至少保留一个抽奖池' };
      }

      const checkRes = await settingsCollection.where({ _id: 'global_config' }).count();
      if (checkRes.total === 0) {
        await settingsCollection.add({
          data: { _id: 'global_config', poolOptions: cleanedPools }
        });
      } else {
        await settingsCollection.doc('global_config').update({
          data: { poolOptions: cleanedPools }
        });
      }
      return { success: true, poolOptions: cleanedPools };
    } catch (err) {
      return { success: false, msg: err.message || '保存池子配置失败' };
    }
  }

  if (event.action === 'updateWeight') {
    try {
      await usersCollection.doc(event.userId).update({
        data: { weight: event.weight }
      });
      return { success: true };
    } catch (err) {
      return { success: false, msg: '数据库更新权重报错' };
    }
  }

  if (event.action === 'executeDraw') {
    try {
      const validPools = await getValidPools();
      if (!validPools.includes(event.poolType)) {
        return { success: false, msg: '请选择有效的抽奖池' };
      }

      const regsRes = await db.collection('registrations').where({ poolType: event.poolType }).get();
      const participants = regsRes.data;

      if (participants.length === 0) {
        return { success: false, msg: `${event.poolType} 池当前无人报名，无法开奖` };
      }

      let drawCount = event.drawCount || 1;
      drawCount = Math.min(drawCount, participants.length);

      const candidates = [];
      for (const p of participants) {
        const userDoc = await usersCollection.where({ openid: p.openid }).get();
        const weight = (userDoc.data.length > 0 && userDoc.data[0].weight !== undefined) ? userDoc.data[0].weight : 100;
        candidates.push({ openid: p.openid, codeName: p.codeName, weight });
      }

      let winners = [];
      let currentPool = [...candidates];

      for (let i = 0; i < drawCount; i++) {
        const totalWeight = currentPool.reduce((sum, c) => sum + c.weight, 0);

        // 全部为 0 时，直接按顺序补位，防止抽奖死循环
        let currentWinner = null;
        if (totalWeight <= 0) {
          currentWinner = currentPool[0];
        } else {
          let randomNum = Math.random() * totalWeight;
          for (const candidate of currentPool) {
            randomNum -= candidate.weight;
            if (randomNum <= 0) {
              currentWinner = candidate;
              break;
            }
          }
        }

        if (!currentWinner) currentWinner = currentPool[0];

        winners.push(currentWinner);
        currentPool = currentPool.filter(c => c.openid !== currentWinner.openid);
      }

      // 权重统一：中签者重置为 100；同池未中签者权重 × 1.2
      const winnerOpenids = winners.map(w => w.openid);
      const updatePromises = candidates.map(candidate => {
        const isWinner = winnerOpenids.includes(candidate.openid);
        const newWeight = isWinner ? 100 : Math.round(candidate.weight * 1.2);
        return usersCollection.where({ openid: candidate.openid }).update({ data: { weight: newWeight } });
      });
      await Promise.all(updatePromises);

      const winnerNamesStr = winners.map(w => w.codeName).join('，');
      await settingsCollection.doc('global_config').update({
        data: {
          lastWinnerCodeName: winnerNamesStr,
          lastWinnerPoolType: event.poolType,
          drawTime: db.serverDate()
        }
      }).catch(async () => {
        await settingsCollection.add({
          data: {
            _id: 'global_config',
            lastWinnerCodeName: winnerNamesStr,
            lastWinnerPoolType: event.poolType,
            drawTime: db.serverDate()
          }
        });
      });

      // 仅清空当前池子报名记录
      await db.collection('registrations').where({ poolType: event.poolType }).remove();

      return { success: true, winnerNames: winnerNamesStr, poolType: event.poolType };
    } catch (err) {
      console.error('抽奖崩溃详情:', err);
      return { success: false, msg: '异常详情: ' + err.message };
    }
  }

  return { success: false, msg: '后端找不到对应的 action 指令: ' + event.action };
};
