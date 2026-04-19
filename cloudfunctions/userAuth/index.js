const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const collection = db.collection('users');
const settingsCollection = db.collection('settings');

const ADMIN_OPENID = "os6Z31_HUyAAzRmXW-5Gxb95CUM8";
const VALID_POOLS = ['前期', '后期', '主持', '写作'];

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;
  const isAdmin = (openId === ADMIN_OPENID);

  if (event.action === 'getConfig') {
    try {
      const configRes = await settingsCollection.doc('global_config').get().catch(() => ({ data: {} }));
      return { success: true, config: configRes.data || {} };
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
        currentRegistration,
        debugOpenId: openId
      };
    }

    return { isBound: false, isAdmin, currentRegistration: null, debugOpenId: openId };
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
      if (!VALID_POOLS.includes(event.poolType)) {
        return { success: false, msg: '抽奖池类型非法' };
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
