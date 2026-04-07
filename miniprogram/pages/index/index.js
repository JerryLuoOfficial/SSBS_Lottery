Page({
  data: {
    timeStatus: 0, 
    config: {},
    isBound: false,
    codeNames: [],
    selectedName: '',
    isAdmin: false
  },

  onLoad() {
    this.initPage();
  },
  
  refreshPage() {
    // 重新执行一遍完整的初始化（查时间、查权限、查名单）
    this.initPage(); 
  },

  async initPage() {
    wx.showLoading({ title: '系统加载中...' });
    try {
      // 1. 查时间配置
      const configRes = await wx.cloud.callFunction({ name: 'userAuth', data: { action: 'getConfig' } });
      if (configRes.result.success && configRes.result.config.startTime) {
        this.setData({ config: configRes.result.config });
        this.checkTimeStatus();
      } else {
        // 如果还没配置时间，默认状态为 1 (未开始)
        this.setData({ timeStatus: 1 });
      }

      // 👇 核心修复：把身份查验挪到外面！无论在不在报名时间内，都要查身份！
      const authRes = await wx.cloud.callFunction({ name: 'userAuth', data: { action: 'check' } });
      
      // 只要是管理员，立刻点亮右下角的齿轮
      if (authRes.result.isAdmin) {
        this.setData({ isAdmin: true });
      }

      // 处理普通用户的绑定逻辑
      if (authRes.result.isBound) {
        this.setData({ isBound: true, selectedName: authRes.result.codeName });
      } else if (this.data.timeStatus === 2) {
        // 只有未绑定的新用户，并且在报名时间内，才去拉取名单
        this.fetchNames();
      }
      
    } catch (e) {
      wx.showToast({ title: '网络异常', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  checkTimeStatus() {
    const { startTime, endTime } = this.data.config;
    if (!startTime || !endTime) return;
    const now = new Date().getTime();
    const start = new Date(startTime.replace(/-/g, '/')).getTime();
    const end = new Date(endTime.replace(/-/g, '/')).getTime();
    let status = 2;
    if (now < start) status = 1;
    else if (now > end) status = 3;
    this.setData({ timeStatus: status });
  },

  async fetchNames() {
    try {
      const res = await wx.cloud.callFunction({ name: 'userAuth', data: { action: 'getNames' } });
      if (res.result.success) this.setData({ codeNames: res.result.names });
    } catch (e) {}
  },

  onSelectName(e) {
    const idx = e.detail.value;
    if (this.data.codeNames.length > 0) {
      this.setData({ selectedName: this.data.codeNames[idx] });
    }
  },

  // 用户点击“确认绑定身份”
  async bindIdentity() {
    if (!this.data.selectedName) return;
    wx.showLoading({ title: '绑定中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'userAuth',
        data: { action: 'bind', codeName: this.data.selectedName }
      });
      if (res.result.success) {
        wx.showToast({ title: '身份绑定成功' });
        this.setData({ isBound: true }); // 瞬间滑到确认报名页
      } else {
        wx.showModal({ title: '提示', content: res.result.msg, showCancel: false });
        this.fetchNames();
        this.setData({ selectedName: '' });
      }
    } catch (err) {
      wx.showToast({ title: '网络异常', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 用户点击“确认进入抽奖池”
  async submitFinalRegistration() {
    wx.showLoading({ title: '正在提交...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'userAuth',
        data: { action: 'registerForDraw', codeName: this.data.selectedName }
      });
      if (res.result.success) {
        wx.showToast({ title: '报名成功！', icon: 'success' });
        setTimeout(() => {
          wx.showModal({ title: '太棒了', content: '您已成功进入抽奖池，请静候开奖佳音！', showCancel: false });
        }, 1500);
      } else {
        wx.showModal({ title: '提示', content: res.result.msg, showCancel: false });
      }
    } catch (err) {
      wx.showToast({ title: '网络异常', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goToAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  },

  onShareAppMessage() {
    return { title: '星河湾电视台任务分配系统', path: '/pages/index/index' };
  },
  onShareTimeline() {
    return { title: '星河湾电视台任务分配系统' };
  }
});