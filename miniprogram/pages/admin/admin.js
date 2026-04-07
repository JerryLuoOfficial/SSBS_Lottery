Page({
  data: {
    // 之前是完整的 startTime 和 endTime，现在拆开存
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    users: [],
    drawCount: 1
  },

  onLoad() {
    this.fetchDashboardData();
  },

  // 1. 获取面板所有数据（重点修改数据回显的逻辑）
  async fetchDashboardData() {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'adminManager',
        data: { action: 'getDashboardData' }
      });

      if (res.result.success) {
        // 假设数据库里存的是 "2023-10-01 10:00"，我们用空格把它切成两半
        const startParts = (res.result.config.startTime || '').split(' ');
        const endParts = (res.result.config.endTime || '').split(' ');

        this.setData({
          startDate: startParts[0] || '',
          startTime: startParts[1] || '',
          endDate: endParts[0] || '',
          endTime: endParts[1] || '',
          users: res.result.users
        });
      }
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 2. 新增四个监听选择器变化的函数
  onStartDateChange(e) { this.setData({ startDate: e.detail.value }); },
  onStartTimeChange(e) { this.setData({ startTime: e.detail.value }); },
  onEndDateChange(e) { this.setData({ endDate: e.detail.value }); },
  onEndTimeChange(e) { this.setData({ endTime: e.detail.value }); },

  // 3. 保存全局时间配置
  async saveTimeConfig() {
    const { startDate, startTime, endDate, endTime } = this.data;
    
    // 👇 加上这句：看看前端抓取到的时间对不对
    console.log('准备保存的时间：', { startDate, startTime, endDate, endTime });

    if (!startDate || !startTime || !endDate || !endTime) {
      return wx.showToast({ title: '请完整选择时间', icon: 'none' });
    }
    // ... 下面原本的代码保持不变

    wx.showLoading({ title: '保存中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'adminManager',
        data: { 
          action: 'saveTimeConfig',
          // 重新拼成 "YYYY-MM-DD HH:mm" 的标准格式发给后端
          startTime: `${startDate} ${startTime}`,
          endTime: `${endDate} ${endTime}`
        }
      });
      if (res.result.success) {
        wx.showToast({ title: '保存成功', icon: 'success' });
      } else {
        wx.showModal({ title: '保存失败', content: res.result.msg, showCancel: false });
      }
    } catch (err) {
      wx.showToast({ title: '网络异常', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // ... 下面的 inputWeight 和 updateWeight 保持完全不变即可

  // 4. 监听列表中某个用户的权重输入
  inputWeight(e) {
    const index = e.currentTarget.dataset.index;
    const value = parseInt(e.detail.value) || 0;
    // 动态更新数组中对应项的值
    this.setData({
      [`users[${index}].weight`]: value
    });
  },

  // 5. 更新单个用户的权重到数据库
  async updateWeight(e) {
    // 提取保存在按钮上的数据库 _id
    const id = e.currentTarget.dataset.id; 
    const index = e.currentTarget.dataset.index;
    const currentWeight = this.data.users[index].weight || 100;

    // 👇 侦探代码 1：看看前端有没有抓瞎
    console.log('准备更新的数据 -> ID:', id, '，新权重:', currentWeight);

    // 防呆拦截：如果前端没拿到 ID，连云函数都不用请求了，直接拦截
    if (!id) {
      return wx.showModal({ title: '致命错误', content: '找不到该条记录的数据库 ID (_id)', showCancel: false });
    }

    wx.showLoading({ title: '更新中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'adminManager',
        data: { 
          action: 'updateWeight',
          userId: id, // 传给后端的身份证
          weight: currentWeight // 传给后端的新权重
        }
      });

      // 👇 侦探代码 2：看看后端经历了什么
      console.log('后端权重更新结果 ->', res.result);

      if (res.result.success) {
        wx.showToast({ title: '权重已更新', icon: 'success' });
      } else {
        // 如果后端拒绝，把后端的原话弹出来！
        wx.showModal({ title: '更新失败', content: res.result.msg || '未知错误', showCancel: false });
      }
    } catch (err) {
      console.error('云函数调用彻底崩溃:', err);
      wx.showModal({ title: '网络/代码异常', content: err.message || '请查看控制台', showCancel: false });
    } finally {
      wx.hideLoading();
    }
  },

  // 监听输入框变化
  inputDrawCount(e) {
    let count = parseInt(e.detail.value);
    if (isNaN(count) || count < 1) count = 1; // 防呆：最少抽 1 个
    this.setData({ drawCount: count });
  },

  // 执行抽奖
  executeDraw() {
    const count = this.data.drawCount;
    wx.showModal({
      title: '高能预警',
      content: `确认现在开奖并抽取 ${count} 名幸运儿吗？操作不可逆！`,
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '疯狂计算中...', mask: true });
          try {
            const drawRes = await wx.cloud.callFunction({
              name: 'adminManager',
              // 👇 核心：把人数传给云函数
              data: { action: 'executeDraw', drawCount: count } 
            });
            if (drawRes.result.success) {
              wx.showModal({ 
                title: '🎯 开奖成功！', 
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
        }
      }
    });
  }
});