# 当前回合 Token usage 展示

- 用户希望在现有执行耗时之外，同时看到当前执行回合消耗的 Token。
- 进度区显示当前回合的输入与输出 Token；Footer 继续显示整个 Session 的累计 usage。
- 最终耗时摘要同时显示当前回合输入、输出、缓存读取和缓存写入。
- 仅展示 Provider/Pi 已返回且可证明 observed 的 usage，不进行本地估算；尚未返回时显示不可用，不能显示伪造的 0。
- mandatory standalone all-zero payload 在没有独立 presence 证据时显示 `Token —`；同一 payload 至少一个字段为正时，其他显式合法零字段显示为 `0`。
- Provider 通常在一次模型响应结束时返回 usage，因此数字允许按响应分段更新，不承诺逐 Token 实时跳动。
