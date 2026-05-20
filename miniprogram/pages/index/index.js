Page({
  data: {
    timeStatus: 0,
    config: {},
    isBound: false,
    codeNames: [],
    selectedName: '',
    isAdmin: false,
    poolOptions: [],
    selectedPool: '',
    currentRegistrationPool: ''
  },

  onLoad() {
    this.initPage();
  },

  refreshPage() {
    this.initPage();
  },

  async initPage() {
    wx.showLoading({ title: '系统加载中...' });
    try {
      const configRes = await wx.cloud.callFunction({ name: 'userAuth', data: { action: 'getConfig' } });
      if (configRes.result.success) {
        const cfg = configRes.result.config || {};
        const poolOptions = (cfg.taskPools || []).map(item => item.name).filter(Boolean);
        this.setData({ config: cfg, poolOptions });
        if (cfg.startTime && cfg.endTime) {
          this.checkTimeStatus();
        } else {
          this.setData({ timeStatus: 1 });
        }
      } else {
        this.setData({ timeStatus: 1 });
      }

      const authRes = await wx.cloud.callFunction({ name: 'userAuth', data: { action: 'check' } });
      const currentRegistration = authRes.result.currentRegistration || null;

      this.setData({
        isAdmin: !!authRes.result.isAdmin,
        currentRegistrationPool: currentRegistration ? currentRegistration.poolType : '',
        selectedPool: currentRegistration ? currentRegistration.poolType : ''
      });

      if (authRes.result.isBound) {
        this.setData({ isBound: true, selectedName: authRes.result.codeName });
      } else if (this.data.timeStatus === 2) {
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

  onSelectPool(e) {
    const idx = e.detail.value;
    if (this.data.poolOptions.length > 0) {
      this.setData({ selectedPool: this.data.poolOptions[idx] });
    }
  },

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
        this.setData({ isBound: true });
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

  async submitFinalRegistration() {
    if (!this.data.selectedPool) {
      return wx.showToast({ title: '请先选择抽奖池', icon: 'none' });
    }

    wx.showLoading({ title: '正在提交...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'userAuth',
        data: {
          action: 'registerForDraw',
          codeName: this.data.selectedName,
          poolType: this.data.selectedPool
        }
      });
      if (res.result.success) {
        this.setData({ currentRegistrationPool: this.data.selectedPool });
        wx.showToast({ title: '选择成功！', icon: 'success' });
      } else {
        wx.showModal({ title: '提示', content: res.result.msg, showCancel: false });
      }
    } catch (err) {
      wx.showToast({ title: '网络异常', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async cancelRegistration() {
    wx.showLoading({ title: '取消中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'userAuth',
        data: { action: 'cancelRegistration' }
      });
      if (res.result.success) {
        this.setData({ currentRegistrationPool: '', selectedPool: '' });
        wx.showToast({ title: '已取消，可重新选择' });
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
