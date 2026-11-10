Component({
  properties: {
    loading: { type: Boolean, value: false },
    hasMore: { type: Boolean, value: true },
    /** 列表为空时不显示「没有更多了」 */
    empty: { type: Boolean, value: false }
  }
});
