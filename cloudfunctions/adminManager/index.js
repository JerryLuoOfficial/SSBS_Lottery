const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const usersCollection = db.collection('users');
const settingsCollection = db.collection('settings');

const DEFAULT_POOLS = [
  { name: '前期', slots: 1 },
  { name: '后期', slots: 1 },
  { name: '主持', slots: 1 },
  { name: '写作', slots: 1 }
];

function normalizeTaskPools(taskPools) {
  const list = Array.isArray(taskPools) ? taskPools : [];
  return list
    .map(item => ({ name: String(item.name || '').trim(), slots: Math.max(1, parseInt(item.slots, 10) || 1) }))
    .filter(item => item.name)
    .filter((item, idx, arr) => arr.findIndex(x => x.name === item.name) === idx);
}

async function getConfigData() {
  const configRes = await settingsCollection.doc('global_config').get().catch(() => ({ data: {} }));
  const config = configRes.data || {};
  const pools = normalizeTaskPools(config.taskPools);
  config.taskPools = pools.length > 0 ? pools : DEFAULT_POOLS;
  return config;
}

exports.main = async (event, context) => {
  if (event.action === 'getDashboardData') {
    try {
      const config = await getConfigData();
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

      return { success: true, config, users: usersWithRegStatus };
    } catch (err) {
      return { success: false, msg: '获取数据失败: ' + err.message };
    }
  }

  if (event.action === 'saveTimeConfig') {
    try {
      const config = await getConfigData();
      const payload = {
        ...config,
        startTime: event.startTime,
        endTime: event.endTime
      };
      await settingsCollection.doc('global_config').set({ data: payload });
      return { success: true };
    } catch (err) {
      return { success: false, msg: err.message || '数据库写入时间异常' };
    }
  }

  if (event.action === 'saveTaskPools') {
    try {
      const pools = normalizeTaskPools(event.taskPools);
      if (pools.length === 0) {
        return { success: false, msg: '请至少保留一个任务池' };
      }
      const config = await getConfigData();
      await settingsCollection.doc('global_config').set({
        data: {
          ...config,
          taskPools: pools
        }
      });
      return { success: true, taskPools: pools };
    } catch (err) {
      return { success: false, msg: err.message || '保存任务池失败' };
    }
  }

  if (event.action === 'updateWeight') {
    try {
      await usersCollection.doc(event.userId).update({ data: { weight: event.weight } });
      return { success: true };
    } catch (err) {
      return { success: false, msg: '数据库更新权重报错' };
    }
  }

  if (event.action === 'executeDraw') {
    try {
      const config = await getConfigData();
      const poolConfig = config.taskPools.find(item => item.name === event.poolType);
      if (!poolConfig) {
        return { success: false, msg: '请选择有效的任务池' };
      }

      const regsRes = await db.collection('registrations').where({ poolType: event.poolType }).get();
      const participants = regsRes.data;
      if (participants.length === 0) {
        return { success: false, msg: `${event.poolType} 池当前无人报名，无法开奖` };
      }

      let drawCount = event.drawCount || poolConfig.slots || 1;
      drawCount = Math.max(1, drawCount);
      drawCount = Math.min(drawCount, poolConfig.slots, participants.length);

      const candidates = [];
      for (const p of participants) {
        const userDoc = await usersCollection.where({ openid: p.openid }).get();
        const weight = (userDoc.data.length > 0 && userDoc.data[0].weight !== undefined) ? userDoc.data[0].weight : 100;
        candidates.push({ openid: p.openid, codeName: p.codeName, weight });
      }

      const winners = [];
      let currentPool = [...candidates];
      for (let i = 0; i < drawCount; i++) {
        const totalWeight = currentPool.reduce((sum, c) => sum + c.weight, 0);
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

      const winnerOpenids = winners.map(w => w.openid);
      await Promise.all(candidates.map(candidate => {
        const newWeight = winnerOpenids.includes(candidate.openid) ? 0 : Math.round(candidate.weight * 1.2);
        return usersCollection.where({ openid: candidate.openid }).update({ data: { weight: newWeight } });
      }));

      const winnerNamesStr = winners.map(w => w.codeName).join('，');
      await settingsCollection.doc('global_config').set({
        data: {
          ...config,
          lastWinnerCodeName: winnerNamesStr,
          lastWinnerPoolType: event.poolType,
          drawTime: db.serverDate()
        }
      });

      await db.collection('registrations').where({ poolType: event.poolType }).remove();
      return { success: true, winnerNames: winnerNamesStr, poolType: event.poolType, drawCount };
    } catch (err) {
      console.error('抽奖崩溃详情:', err);
      return { success: false, msg: '异常详情: ' + err.message };
    }
  }

  return { success: false, msg: '后端找不到对应的 action 指令: ' + event.action };
};
