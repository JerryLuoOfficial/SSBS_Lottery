Page({
  data: {
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    users: [],
    drawCount: 1,
    drawPools: ['前期', '后期', '主持', '写作'],
    selectedDrawPool: '前期'
  },

  onLoad() {
    this.fetchDashboardData();
  },

  async fetchDashboardData() {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await wx.cloud.callFunction({ name: 'adminManager', data: { action: 'getDashboardData' } });
      if (res.result.success) {
        const startParts = (res.result.config.startTime || '').split(' ');
        const endParts = (res.result.config.endTime || '').split(' ');

        this.setData({
          startDate: startParts[0] || '',
          startTime: startParts[1] || '',
          endDate: endParts[0] || '',
          endTime: endParts[1] || '',
          users: res.result.users,
          drawPools: pools.map(item => item.name),
          selectedDrawPool: pools[0] ? pools[0].name : '',
          taskPoolsText
        });
      }
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onStartDateChange(e) { this.setData({ startDate: e.detail.value }); },
  onStartTimeChange(e) { this.setData({ startTime: e.detail.value }); },
  onEndDateChange(e) { this.setData({ endDate: e.detail.value }); },
  onEndTimeChange(e) { this.setData({ endTime: e.detail.value }); },
  onTaskPoolsTextChange(e) { this.setData({ taskPoolsText: e.detail.value }); },

  parseTaskPools(text) {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(',');
        const name = (parts[0] || '').trim();
        const slots = Math.max(1, parseInt((parts[1] || '1').trim(), 10) || 1);
        return { name, slots };
      })
      .filter(item => item.name);
  },

  async saveTaskPools() {
    const taskPools = this.parseTaskPools(this.data.taskPoolsText);
    if (taskPools.length === 0) {
      return wx.showToast({ title: '请至少配置一个任务池', icon: 'none' });
    }

    wx.showLoading({ title: '保存任务池中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({ name: 'adminManager', data: { action: 'saveTaskPools', taskPools } });
      if (res.result.success) {
        wx.showToast({ title: '任务池保存成功', icon: 'success' });
        this.fetchDashboardData();
      } else {
        wx.showModal({ title: '保存失败', content: res.result.msg || '未知错误', showCancel: false });
      }
    } catch (err) {
      wx.showToast({ title: '网络异常', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async saveTimeConfig() {
    const { startDate, startTime, endDate, endTime } = this.data;

    if (!startDate || !startTime || !endDate || !endTime) {
      return wx.showToast({ title: '请完整选择时间', icon: 'none' });
    }

    wx.showLoading({ title: '保存中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'adminManager',
        data: {
          action: 'saveTimeConfig',
          startTime: `${startDate} ${startTime}`,
          endTime: `${endDate} ${endTime}`
        }
      });
      if (res.result.success) wx.showToast({ title: '保存成功', icon: 'success' });
      else wx.showModal({ title: '保存失败', content: res.result.msg, showCancel: false });
    } catch (err) {
      wx.showToast({ title: '网络异常', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  inputWeight(e) {
    const index = e.currentTarget.dataset.index;
    const value = parseInt(e.detail.value) || 0;
    this.setData({
      [`users[${index}].weight`]: value
    });
  },

  async updateWeight(e) {
    const id = e.currentTarget.dataset.id;
    const index = e.currentTarget.dataset.index;
    const currentWeight = this.data.users[index].weight || 0;

    if (!id) {
      return wx.showModal({ title: '致命错误', content: '找不到该条记录的数据库 ID (_id)', showCancel: false });
    }

    wx.showLoading({ title: '更新中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'adminManager',
        data: {
          action: 'updateWeight',
          userId: id,
          weight: currentWeight
        }
      });

      if (res.result.success) {
        wx.showToast({ title: '权重已更新', icon: 'success' });
      } else {
        wx.showModal({ title: '更新失败', content: res.result.msg || '未知错误', showCancel: false });
      }
    } catch (err) {
      wx.showModal({ title: '网络/代码异常', content: err.message || '请查看控制台', showCancel: false });
    } finally {
      wx.hideLoading();
    }
  },

  inputDrawCount(e) {
    let count = parseInt(e.detail.value);
    if (isNaN(count) || count < 1) count = 1;
    this.setData({ drawCount: count });
  },

  onDrawPoolChange(e) {
    const idx = e.detail.value;
    this.setData({ selectedDrawPool: this.data.drawPools[idx] });
  },

  executeDraw() {
    const count = this.data.drawCount;
    const poolType = this.data.selectedDrawPool;

    wx.showModal({
      title: '高能预警',
      content: `确认在【${poolType}】池开奖并抽取 ${count} 名幸运儿吗？操作不可逆！`,
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '疯狂计算中...', mask: true });
          try {
            const drawRes = await wx.cloud.callFunction({
              name: 'adminManager',
              data: { action: 'executeDraw', drawCount: count, poolType }
            });
            if (drawRes.result.success) {
              wx.showModal({
                title: `🎯 ${poolType}池开奖成功！`,
                content: `本次抽中的是：\n${drawRes.result.winnerNames}`,
                showCancel: false
              });
              this.fetchDashboardData();
            } else {
              wx.showModal({ title: '开奖失败', content: drawRes.result.msg, showCancel: false });
            }
          } catch (err) {
            wx.showToast({ title: '网络异常', icon: 'none' });
          } finally {
            wx.hideLoading();
          }
        } catch (err) {
          wx.showToast({ title: '网络异常', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  }
});
