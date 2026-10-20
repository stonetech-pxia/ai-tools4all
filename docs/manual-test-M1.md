# M1 手动测试清单

自动化测试只用模拟页面，这份清单覆盖它们测不到的部分：真实的 OpenRouter 和 Groq 网站、真实账号，以及本工具在真实电脑上自己运行 OmniRoute。

在项目目录下运行：

```bash
npm start
```

第一次运行时会先准备内置的 OmniRoute（需要几分钟，只做一次）。之后本工具会自己在 **20138** 端口上运行 OmniRoute。

每一项请记录：✅ / ❌，加上备注（任何异常都请截图）。
日志目录（Windows：`%APPDATA%\omniroute-onboard\logs\`，macOS：`~/Library/Application Support/omniroute-onboard/logs/`）里有两个文件：`onboard.log`（本工具）和 `omniroute.log`（OmniRoute）。

界面目前只有英文，下面引号里的按钮和提示文字都按界面上的英文原样给出。

## A. 启动

1. [ ] 窗口先显示 "Starting OmniRoute…"，然后进入欢迎页。记下第一次启动用了多长时间。
2. [ ] 在浏览器里打开 `http://localhost:20138/api/providers`，应显示 "Unauthorized" 错误（说明 OmniRoute 已上锁）。

## B. OpenRouter（真实账号，OAuth 授权）

1. [ ] 只勾选 OpenRouter。确认提示里写明 Key 的名称为 `omniroute-YYYYMMDD`。
2. [ ] 点 "Yes, create it" 后，OpenRouter 在你**平时用的**浏览器里打开，而不是在本工具的窗口里。
3. [ ] 自己登录并点授权。之后浏览器标签页显示 "Done. You can close this tab…"。
4. [ ] 本工具自动继续：验证 Key → 写入 OmniRoute → 显示结果。
5. [ ] 在 openrouter.ai → Keys 里能看到名为 `omniroute-YYYYMMDD` 的 Key。
6. [ ] 等待授权期间点 "Open the page again"，会重新打开授权页面。
7. [ ] 记下 openrouter.ai/settings/privacy 里那个隐私开关的准确名称（没有账号我们无法核实），以便把提示文字写准确。

## C. Groq，在你的常用浏览器里完成（默认方式）

1. [ ] Groq 的 API Key 页面在你**平时用的**浏览器里打开。如果你之前已经登录过 Groq（或在这个浏览器里登录过 GitHub/Google），登录会很快。
2. [ ] 本工具的窗口缩成右下角的小窗，并保持在浏览器上方。
3. [ ] 它询问能否从剪贴板接收 Key。选择 **Yes**（"Yes, pick it up"）。
   - macOS：记下系统有没有弹出"允许读取剪贴板"的提示。
4. [ ] 按提示的名称创建 Key，在 Groq 里点 Copy：本工具在一两秒内自动接着往下走。
5. [ ] 之后剪贴板里已经没有这个 Key 了（随便找个地方粘贴一下确认）。
6. [ ] 本工具等待期间复制其他无关文字，不会有任何反应。
7. [ ] 再跑一次，这次对剪贴板问题选择 **No**（"No, I'll paste it"）：复制 Key 不会被接收；把 Key 粘贴进本工具可以正常完成。
8. [ ] 点 "Open the page again" 会重新打开 Key 页面。
9. [ ] 流程结束后，本工具窗口恢复原来的大小，不再置顶。

## C2. Groq，在本工具的独立窗口里完成（备选方式："Let the helper click for me"）

1. [ ] 打开一个单独的窗口，显示 console.groq.com，右下角有蓝色的提示面板。
2. [ ] 面板可以拖动、可以最小化；页面跳转后面板仍然在。
3. [ ] 用邮箱或 GitHub 登录。如果 Google 登录被拦截，请记下来（这是预期的）。
4. [ ] 登录后本工具自动往下走（或者点 "I'm done" 之后往下走）。
5. [ ] 它打开 API Key 页面，请你确认 Key 的名称。
6. [ ] 点 "Yes, create it" 之后：对话框打开、名称自动填好、Key 被创建，本工具读取到 Key。如果其中某一步卡住，请记下**是哪一步**，并把页面另存下来（Ctrl+S），用于修正 `src/providers/groq/config.json` 里的配置。
7. [ ] 中途关掉这个窗口，会提示 "The service window was closed."；点 "Try automatically again" 会重新打开它。
8. [ ] 粘贴一个错误的 Key，会提示 "The service says this key isn't valid."

## D. 结果

1. [ ] 显示 Base URL `http://localhost:20138/v1` 和一个打了掩码的 Key；"Show" 和 "Copy" 都能用。
2. [ ] 在 OmniRoute 仪表盘里，两个服务商都已列出且处于启用状态。
3. [ ] 结果页说明里写着模型名用 `free`。下面的命令能正常返回（把 `KEY` 换成你的 Key。Key 会留在 shell 历史记录里，测完记得清掉）：

   ```bash
   curl http://localhost:20138/v1/chat/completions -H "Authorization: Bearer KEY" -H "Content-Type: application/json" -d "{\"model\":\"free\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"
   ```

   `free` 会先用 Groq 的免费模型，用完或出错时自动换到 OpenRouter 的免费模型。用下面的命令查看 Key 能用的模型，应该只有 `free` 一项：

   ```bash
   curl http://localhost:20138/v1/models -H "Authorization: Bearer KEY"
   ```
4. [ ] **不会产生费用**：把上面聊天命令里的模型换成 `groq/openai/gpt-oss-20b`、`auto`、`openrouter/openai/gpt-4o`（付费模型），都应返回 403 "not allowed for this API key"。不带 Key 或带假 Key（比如字面上的 `KEY`）应返回 401。
5. [ ] 你之前生成的那个 Key（升级前的）现在也只能用 `free`：用它试上一条的付费模型，同样返回 403。
6. [ ] 如果你的 OpenRouter 账户充值过，结果页会出现建议设置消费上限的提醒；没充值过则没有这条提醒。
7. [ ] 如果用过独立窗口方式（C2）：点 "Delete it"（删除独立窗口的浏览器数据）→ 再走一次 C2 → Groq 会要求重新登录。

## E. 设置完成之后

1. [ ] 在结果页点 "Done"，进入主页：显示 OmniRoute 正在运行、地址、已接入的服务。
2. [ ] 关掉窗口（点 X）后 OmniRoute 仍在运行：AI 工具或 D 里的 curl 命令照常能用。托盘里有图标（Windows 会弹一次提示）。
3. [ ] 点托盘图标，窗口重新出现，显示的是主页，而不是向导。
4. [ ] 本工具运行期间再执行一次 `npm start`，只会把已有的窗口调到前面。
5. [ ] 托盘菜单 → Quit 会停掉 OmniRoute（D 里的 curl 命令此时会失败）。再次 `npm start` → 直接进入主页；已接入的服务都还在，原来的 Key 仍然有效。
6. [ ] "Add services"：已接入的服务标着 "Connected"，不能再选第二次。
7. [ ] "Create a new key" 会显示一次新 Key；用它跑 curl 能正常返回。
8. [ ] "Open dashboard" 在浏览器里打开 OmniRoute 仪表盘；用主页上复制的密码可以登录。

## F. 隐私检查

1. [ ] 在日志文件里搜索 `gsk_`、`sk-or-`、`sk-`：没有任何匹配。
2. [ ] 运行 `npm start` 的终端里没有打印出任何像 Key 的内容。
3. [ ] 在任何一步跳过或关掉服务窗口，本工具都不会崩溃；向导会提供粘贴或跳过的选项。
4. [ ] 在剪贴板询问之前复制过的内容（以及无关文字），不会出现在本工具的任何地方或日志里。
