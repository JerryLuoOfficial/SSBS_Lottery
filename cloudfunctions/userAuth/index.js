const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const collection = db.collection('users');
const settingsCollection = db.collection('settings');

// 👇 在这里填入你刚才查到的真实的 OpenID (保留单引号)
const ADMIN_OPENID = "os6Z31_HUyAAzRmXW-5Gxb95CUM8";

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;

  // 判断当前请求的人是不是管理员
  const isAdmin = (openId === ADMIN_OPENID);

  // 👇 2. 新增动作：让前端不登录也能获取活动时间
  if (event.action === 'getConfig') {
    try {
      // 容错处理：如果管理员还没设置过时间，返回空对象
      const configRes = await settingsCollection.doc('global_config').get().catch(() => ({ data: {} }));
      return { success: true, config: configRes.data || {} };
    } catch (err) {
      return { success: false };
    }
  }
  // 动作 0：获取目前【还没有被人绑定】的代号名单
  if (event.action === 'getNames') {
    try {
      const res = await collection.where({ openid: _.exists(false) }).get();
      const namesList = res.data.map(item => item.codeName);
      return { success: true, names: namesList };
    } catch (err) {
      return { success: false, msg: '拉取名单失败' };
    }
  }

  // 动作 1：检查该微信是否已经占过座位了，并下发管理员特权
  if (event.action === 'check') {
    const userResult = await collection.where({ openid: openId }).get();
    if (userResult.data.length > 0) {
      // 👇 注意看这里，加上了 debugOpenId
      return { isBound: true, codeName: userResult.data[0].codeName, isAdmin: isAdmin, debugOpenId: openId };
    }
    // 👇 这里也加上
    return { isBound: false, isAdmin: isAdmin, debugOpenId: openId };
  }

  // 动作 2：执行绑定（核心防并发控制）
  if (event.action === 'bind') {
    try {
      const alreadyBound = await collection.where({ openid: openId }).count();
      if (alreadyBound.total > 0) {
        return { success: false, msg: '您的微信已经绑定过身份，无法重复绑定' };
      }

      const updateResult = await collection.where({
        codeName: event.codeName,
        openid: _.exists(false) // 👈 依赖顶部的 const _ = db.command
      }).update({
        data: {
          openid: openId,
          bindTime: db.serverDate(),
          weight: 100 // 顺便给新绑定的用户初始化一个默认权重
        }
      });

      if (updateResult.stats.updated === 1) {
        return { success: true };
      } else {
        return { success: false, msg: '手慢了，该代号刚刚被别人绑定啦，请重新选择！' };
      }
    } catch (err) {
      console.error('绑定报错详情:', err); // 方便在云端日志排查
      return { success: false, msg: '数据库更新失败，请重试' };
    }
  }
  // 动作 3：正式报名进入抽奖池
  if (event.action === 'registerForDraw') {
    try {
      // 1. 检查是否已经报名过了（防止重复往抽奖箱里扔纸条）
      const checkReg = await db.collection('registrations').where({ openid: openId }).count();
      if (checkReg.total > 0) {
        return { success: false, msg: '您已在抽奖池中，请勿重复报名' };
      }

      // 2. 写入抽奖箱
      await db.collection('registrations').add({
        data: {
          openid: openId,
          codeName: event.codeName, // 记录下他的代号
          joinTime: db.serverDate() // 报名时间
        }
      });
      return { success: true };
    } catch (err) {
      console.error('报名写入失败:', err);
      return { success: false, msg: '报名失败，请重试' };
    }
  }
};