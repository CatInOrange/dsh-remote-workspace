/** Remote panel copy, including failure states. */
export const en = {
  title: 'Linux workspace', address: 'Server address', token: 'Access token (first login)',
  connect: 'Connect', disconnect: 'Disconnect', retry: 'Reload', loading: 'Connecting…',
  error: 'Connection failed. Check the address, network and access token, then retry.',
  invalid: 'Enter an HTTPS server origin or a Harness login link.',
  unsupported: 'This plugin requires the Harness desktop browser bridge.',
  note: 'Remote sessions and tools run on Linux. This preview embeds the remote UI, including its workspace list.',
  auth: 'Use the native Harness access token, not your DeepSeek API key. Only the server address is saved.',
  offline: 'Offline — Linux tasks are not moved to Windows.',
}
export const zh: typeof en = {
  title: 'Linux 工作区', address: '服务器地址', token: '访问令牌（首次登录）',
  connect: '连接', disconnect: '断开', retry: '重新加载', loading: '正在连接…',
  error: '连接失败，请检查地址、网络和访问令牌后重试',
  invalid: '请输入 HTTPS 服务器地址或 Harness 登录链接',
  unsupported: '此插件需要 Harness 桌面版的浏览器桥接功能',
  note: '远程会话和工具在 Linux 执行。预览版内嵌远程界面，包含服务器自己的工作区列表。',
  auth: '填写 Harness 原生访问令牌，不是 DeepSeek API Key。插件仅保存服务器地址。',
  offline: '网络离线，Linux 任务不会转到 Windows 执行',
}
