// app.js
const { envList } = require('./envList');

App({
  onLaunch: function () {
    // 优先读取 envList 首个环境，避免换环境时必须改代码；若没有则回退到默认值
    const fallbackEnv = 'cloud1-5g58ngejb888d482';
    const env = (Array.isArray(envList) && envList.length > 0 && envList[0]) ? envList[0] : fallbackEnv;

    this.globalData = { env };

    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }

    wx.cloud.init({
      env: this.globalData.env,
      traceUser: true,
    });

    console.log('当前云环境：', this.globalData.env);
  },
});
