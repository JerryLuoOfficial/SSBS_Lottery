const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const collection = db.collection('users');
const settingsCollection = db.collection('settings');

const ADMIN_OPENID = "os6Z31_HUyAAzRmXW-5Gxb95CUM8";
const DEFAULT_POOLS = [
  { name: '前期', slots: 1 },
  { name: '后期', slots: 1 },
  { name: '主持', slots: 1 },
  { name: '写作', slots: 1 }
];

async function getTaskPools() {
  const configRes = await settingsCollection.doc('global_config').get().catch(() => ({ data: {} }));
  const pools = (configRes.data && Array.isArray(configRes.data.taskPools) && configRes.data.taskPools.length > 0)
    ? configRes.data.taskPools
    : DEFAULT_POOLS;
  return pools
    .map(p => ({ name: String(p.name || '').trim(), slots: Math.max(1, parseInt(p.slots, 10) || 1) }))
    .filter(p => p.name);
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;
  const isAdmin = (openId === ADMIN_OPENID);

  if (event.action === 'getConfig') {
    try {
      const configRes = await settingsCollection.doc('global_config').get().catch(() => ({ data: {} }));
      const config = configRes.data || {};
      if (!Array.isArray(config.taskPools) || config.taskPools.length === 0) {
        config.taskPools = DEFAULT_POOLS;
      }
      return { success: true, config };
    } catch (err) {
      return { success: false };
    }
  }

  if (event.action === 'getNames') {
    try {
      const res = await collection.where({ openid: _.exists(false) }).get();
      const namesList = res.data.map(item => item.codeName);
      return { success: true, names: namesList };
    } catch (err) {
      return { success: false, msg: '拉取名单失败' };
    }
  }

  if (event.action === 'check') {
    const userResult = await collection.where({ openid: openId }).get();
    const regRes = await db.collection('registrations').where({ openid: openId }).get().catch(() => ({ data: [] }));
    const currentRegistration = regRes.data[0] || null;

    if (userResult.data.length > 0) {
      return {
        isBound: true,
        codeName: userResult.data[0].codeName,
        isAdmin,
        currentRegistration
      };
    }

    return { isBound: false, isAdmin, currentRegistration: null };
  }

  if (event.action === 'bind') {
    try {
      const alreadyBound = await collection.where({ openid: openId }).count();
      if (alreadyBound.total > 0) {
        return { success: false, msg: '您的微信已经绑定过身份，无法重复绑定' };
      }

      const updateResult = await collection.where({
        codeName: event.codeName,
        openid: _.exists(false)
      }).update({
        data: {
          openid: openId,
          bindTime: db.serverDate(),
          weight: 100
        }
      });

      if (updateResult.stats.updated === 1) {
        return { success: true };
      }

      return { success: false, msg: '手慢了，该代号刚刚被别人绑定啦，请重新选择！' };
    } catch (err) {
      console.error('绑定报错详情:', err);
      return { success: false, msg: '数据库更新失败，请重试' };
    }
  }

  if (event.action === 'registerForDraw') {
    try {
      const taskPools = await getTaskPools();
      const validPoolNames = taskPools.map(p => p.name);
      if (!validPoolNames.includes(event.poolType)) {
        return { success: false, msg: '当前任务池不存在，请刷新后重试' };
      }

      const checkReg = await db.collection('registrations').where({ openid: openId }).count();
      if (checkReg.total > 0) {
        return { success: false, msg: '您已选择抽奖池，可先取消后重新选择' };
      }

      await db.collection('registrations').add({
        data: {
          openid: openId,
          codeName: event.codeName,
          poolType: event.poolType,
          joinTime: db.serverDate()
        }
      });
      return { success: true };
    } catch (err) {
      console.error('报名写入失败:', err);
      return { success: false, msg: '报名失败，请重试' };
    }
  }

  if (event.action === 'cancelRegistration') {
    try {
      const removeRes = await db.collection('registrations').where({ openid: openId }).remove();
      if (removeRes.stats.removed > 0) {
        return { success: true };
      }
      return { success: false, msg: '您当前没有已选择的抽奖池' };
    } catch (err) {
      console.error('取消报名失败:', err);
      return { success: false, msg: '取消失败，请重试' };
    }
  }

  return { success: false, msg: '未知 action: ' + event.action };
};
