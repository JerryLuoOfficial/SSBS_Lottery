const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command; //
const usersCollection = db.collection('users');
const settingsCollection = db.collection('settings');

exports.main = async (event, context) => {
  // 动作 1：获取面板所有数据
  // 动作 1：获取面板所有数据（升级版：合并报名状态）
  if (event.action === 'getDashboardData') {
    try {
      const configRes = await settingsCollection.doc('global_config').get().catch(() => ({ data: {} }));
      const usersRes = await usersCollection.get();
      
      // 新增：去抽奖箱里捞出所有已经报名的记录
      // 加上 catch 防止如果集合还没建好导致整个后台崩溃
      const regsRes = await db.collection('registrations').get().catch(() => ({ data: [] })); 
      // 把所有已报名的代号提取成一个数组，比如：['代号 Alpha', '代号 Beta']
      const registeredNames = regsRes.data.map(item => item.codeName);

      // 👇 新增：给每个用户打上“是否已报名”的标签
      const usersWithRegStatus = usersRes.data.map(user => {
        return {
          ...user,
          hasRegistered: registeredNames.includes(user.codeName) // 如果在报名数组里，就是 true
        };
      });

      return { success: true, config: configRes.data || {}, users: usersWithRegStatus };
    } catch (err) {
      return { success: false, msg: '获取数据失败: ' + err.message };
    }
  }

  // 动作 2：保存时间设置（带自动创建功能）
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

  // 动作 3：更新指定用户的权重（之前就是丢了这一段！）
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
  // 动作 4：执行加权抽奖 (支持自定义人数)
  if (event.action === 'executeDraw') {
    try {
      const regsRes = await db.collection('registrations').get();
      const participants = regsRes.data;

      if (participants.length === 0) {
        return { success: false, msg: '当前抽奖池空无一人，无法开奖' };
      }

      // 接收前端传来的抽取人数，默认为 1。如果要求抽的人数比报名的人还多，就全员中奖。
      let drawCount = event.drawCount || 1;
      drawCount = Math.min(drawCount, participants.length);

      // 准备候选人名单和权重
      const candidates = [];
      for (let p of participants) {
        const userDoc = await usersCollection.where({ openid: p.openid }).get();
        const weight = (userDoc.data.length > 0 && userDoc.data[0].weight !== undefined) ? userDoc.data[0].weight : 100;
        candidates.push({ openid: p.openid, codeName: p.codeName, weight: weight });
      }

      // 核心：批量抽取且不重复
      let winners = [];
      let currentPool = [...candidates]; // 复制一份当前池子用于抽取

      for (let i = 0; i < drawCount; i++) {
        let totalWeight = currentPool.reduce((sum, c) => sum + c.weight, 0);
        let randomNum = Math.random() * totalWeight;
        let currentWinner = null;
        
        for (let candidate of currentPool) {
          randomNum -= candidate.weight;
          if (randomNum <= 0) {
            currentWinner = candidate;
            break;
          }
        }
        if (!currentWinner) currentWinner = currentPool[0]; // 兜底

        winners.push(currentWinner);
        // 把刚中奖的人从当前池子里剔除，防止下次循环又抽到他
        currentPool = currentPool.filter(c => c.openid !== currentWinner.openid);
      }

      // 洗牌权重：中奖者全部重置 100，陪跑者全部 × 1.2
      const winnerOpenids = winners.map(w => w.openid);
      const updatePromises = candidates.map(candidate => {
        let newWeight = winnerOpenids.includes(candidate.openid) ? 100 : Math.round(candidate.weight * 1.2);
        return usersCollection.where({ openid: candidate.openid }).update({
          data: { weight: newWeight }
        });
      });
      await Promise.all(updatePromises);

      // 提取所有中奖者的名字，拼成一个字符串，比如 "张三, 李四, 王五"
      const winnerNamesStr = winners.map(w => w.codeName).join('，');

      // 记录结果
      await settingsCollection.doc('global_config').update({
        data: {
          lastWinnerCodeName: winnerNamesStr, // 存入用逗号隔开的名单
          drawTime: db.serverDate()
        }
      });

      // 清空奖池
      await db.collection('registrations').where({
        _id: _.exists(true)
      }).remove();

      return { success: true, winnerNames: winnerNamesStr };
    } catch (err) {
      console.error('抽奖崩溃详情:', err);
      return { success: false, msg: '异常详情: ' + err.message }; 
    }
  }

  // 🛡️ 终极防御：如果指令输错了，绝不返回 null，而是明确报错
  return { success: false, msg: '后端找不到对应的 action 指令: ' + event.action };
};