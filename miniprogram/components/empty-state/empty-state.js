Component({
  properties: {
    /** 主文案 */
    text: { type: String, value: '暂无数据' },
    /** 副文案 */
    desc: { type: String, value: '' },
    /** 图标字符，用 emoji 或符号避免依赖图片资源 */
    icon: { type: String, value: '📦' },
    /** 按钮文案，为空则不显示 */
    buttonText: { type: String, value: '' }
  },

  methods: {
    onAction() {
      this.triggerEvent('action');
    }
  }
});
