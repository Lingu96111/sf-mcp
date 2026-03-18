// 引入 VSCode 扩展 API
const vscode = require("vscode");
// 引入子进程与路径、文件系统
const cp = require("child_process");
const path = require("path");
const fs = require("fs");

// 提高监听器上限，避免告警
if (typeof process !== "undefined" && process.setMaxListeners) {
  process.setMaxListeners(32);
}

// 当前 MCP 子进程句柄，未启动时为 null
let serverProcess = null;
// 状态栏项，显示 MCP 是否就绪
let statusBarItem = null;
// 输出通道，用于 Org 别名等调试日志
let outputChannelForDebug = null;

// 获取或创建 MCP 输出通道
function getAliasOutputChannel() {
  if (!outputChannelForDebug) {
    outputChannelForDebug = vscode.window.createOutputChannel("Salesforce MCP");
  }
  return outputChannelForDebug;
}

// 解析 Org 别名及来源：优先 .sf/config.json（与官方插件一致），否则用设置
function getEffectiveOrgAliasWithSource(workspaceRootFsPath) {
  if (workspaceRootFsPath) {
    const sfConfigPath = path.join(workspaceRootFsPath, ".sf", "config.json");
    try {
      if (fs.existsSync(sfConfigPath)) {
        const data = JSON.parse(fs.readFileSync(sfConfigPath, "utf8"));
        const targetOrg = (data["target-org"] || "").trim();
        if (targetOrg) return { alias: targetOrg, source: "sfConfig" };
      }
    } catch (e) {
      getAliasOutputChannel().appendLine(
        `[Org 别名调试] 读取 .sf/config.json 异常: ${e && e.message}`
      );
    }
  }
  const config = vscode.workspace.getConfiguration("salesforceMcp");
  const fromSettings = (config.get("sfOrgAlias") || "").trim();
  if (fromSettings) return { alias: fromSettings, source: "settings" };
  return { alias: "", source: "none" };
}

// 将 Org 别名写入输出通道供调试
function logOrgAliasDebug(workspaceRootFsPath, alias, source) {
  const ch = getAliasOutputChannel();
  const ts = new Date().toISOString();
  const workspaceDesc = workspaceRootFsPath || "(无工作区)";
  const aliasDesc = alias ? `"${alias}"` : "(空)";
  const sourceDesc =
    source === "settings"
      ? "设置 salesforceMcp.sfOrgAlias"
      : source === "sfConfig"
        ? "工作区 .sf/config.json target-org"
        : "未解析到";
  ch.appendLine(`[Org 别名调试] ${ts}`);
  ch.appendLine(`  工作区: ${workspaceDesc}`);
  ch.appendLine(`  来源: ${sourceDesc}`);
  ch.appendLine(`  当前生效别名: ${aliasDesc}`);
  ch.appendLine("");
}

// 提示 MCP 配置已更新（无需重载，直接可用）
function showConfigUpdated(message) {
  vscode.window.showInformationMessage(message);
}

// MCP 由 esbuild 打入 server/dist/mcp.js
function getBundledMcpPathStr(context) {
  return path.join(context.extensionPath, "server", "dist", "mcp.js");
}

// 判断即将写入的 salesforce-mcp 条与现有是否一致
function isSameMcpEntry(existing, newEntry) {
  if (!existing || !newEntry) return false;
  if (existing.command !== newEntry.command) return false;
  if (JSON.stringify(existing.args || []) !== JSON.stringify(newEntry.args || [])) return false;
  if (existing.enabled !== newEntry.enabled) return false;
  const envKeys = ["SF_AUTH_MODE", "SF_ORG_ALIAS", "SF_CLI_PATH", "SF_INSTANCE_URL", "SF_ACCESS_TOKEN"];
  for (const k of envKeys) {
    const a = existing.env && existing.env[k];
    const b = newEntry.env && newEntry.env[k];
    if (a !== b) return false;
  }
  return true;
}

// 向工作区写入 mcp.json 的 salesforce-mcp 条
function writeMcpConfigToDir(targetDir, entryPathStr, envObj) {
  const cursorDir = path.join(targetDir, ".cursor");
  const mcpPath = path.join(cursorDir, "mcp.json");
  let mcpConfig;
  try {
    if (fs.existsSync(mcpPath)) {
      mcpConfig = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    } else {
      mcpConfig = { mcpServers: {} };
    }
  } catch (_) {
    mcpConfig = { mcpServers: {} };
  }
  if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== "object") {
    mcpConfig.mcpServers = {};
  }
  // 仅覆盖 salesforce-mcp 一项，保留其它 MCP 配置
  mcpConfig.mcpServers["salesforce-mcp"] = {
    command: process.execPath,
    args: [entryPathStr],
    env: envObj,
    enabled: true
  };
  try {
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2), "utf8");
    return true;
  } catch (err) {
    return false;
  }
}

// 按设置写 mcp 配置；若与现有完全相同则不写、不提示。返回 written、wasNew、unchanged
function writeMcpConfig(context) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return { written: false, wasNew: false, unchanged: false };
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const wasAlreadyConfigured = isMcpConfiguredInWorkspace(workspaceRoot);
  const { alias: sfOrgAliasStr, source: orgAliasSource } =
    getEffectiveOrgAliasWithSource(workspaceRoot);
  logOrgAliasDebug(workspaceRoot, sfOrgAliasStr, orgAliasSource);

  const config = vscode.workspace.getConfiguration("salesforceMcp");
  const sfAuthModeStr = config.get("sfAuthMode") || "";
  const sfCliPathStr = config.get("sfCliPath") || "";
  const sfInstanceUrlStr = config.get("sfInstanceUrl") || "";
  const sfAccessTokenStr = config.get("sfAccessToken") || "";

  const envObj = {};
  if (sfAuthModeStr) envObj.SF_AUTH_MODE = sfAuthModeStr;
  if (sfOrgAliasStr) envObj.SF_ORG_ALIAS = sfOrgAliasStr;
  if (sfCliPathStr) envObj.SF_CLI_PATH = sfCliPathStr;
  if (sfInstanceUrlStr) envObj.SF_INSTANCE_URL = sfInstanceUrlStr;
  if (sfAccessTokenStr) envObj.SF_ACCESS_TOKEN = sfAccessTokenStr;

  const entryPathStr = getBundledMcpPathStr(context);
  const newEntry = {
    command: process.execPath,
    args: [entryPathStr],
    env: envObj,
    enabled: true
  };

  // 与工作区现有配置一致则不再写入、不提示
  const mcpPath = path.join(workspaceRoot, ".cursor", "mcp.json");
  try {
    if (fs.existsSync(mcpPath)) {
      const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
      const existing = mcpConfig.mcpServers && mcpConfig.mcpServers["salesforce-mcp"];
      if (isSameMcpEntry(existing, newEntry)) {
        updateStatusBar();
        return { written: false, wasNew: false, unchanged: true };
      }
    }
  } catch (_) {}

  const extPathNorm = path.normalize(context.extensionPath);
  const workspaceRootNorm = path.normalize(workspaceRoot);
  const targetsToWrite = [workspaceRoot];
  if (workspaceRootNorm === extPathNorm || workspaceRootNorm.startsWith(extPathNorm + path.sep)) {
    const parentDir = path.dirname(workspaceRootNorm);
    if (parentDir && parentDir !== workspaceRootNorm) {
      targetsToWrite.push(parentDir);
    }
  }

  let written = false;
  for (const dir of targetsToWrite) {
    if (writeMcpConfigToDir(dir, entryPathStr, envObj)) {
      written = true;
    }
  }

  if (!written) {
    vscode.window.showErrorMessage("写入 MCP 配置失败，请检查 .cursor 目录权限。");
    updateStatusBar();
    return { written: false, wasNew: false, unchanged: false };
  }

  updateStatusBar();
  return { written: true, wasNew: !wasAlreadyConfigured, unchanged: false };
}

// 判断工作区是否已包含 salesforce-mcp 配置
function isMcpConfiguredInWorkspace(workspaceRootFsPath) {
  if (!workspaceRootFsPath) return false;
  const mcpPath = path.join(workspaceRootFsPath, ".cursor", "mcp.json");
  try {
    if (!fs.existsSync(mcpPath)) return false;
    const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    return !!(mcpConfig.mcpServers && mcpConfig.mcpServers["salesforce-mcp"]);
  } catch (_) {
    return false;
  }
}

// 按是否已配置更新状态栏
function updateStatusBar() {
  if (!statusBarItem) return;
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceRoot = workspaceFolder ? workspaceFolder.uri.fsPath : "";
  const configured = isMcpConfiguredInWorkspace(workspaceRoot);
  if (configured) {
    statusBarItem.text = "$(check-all) SFMCP 就绪";
  } else {
    statusBarItem.text = "$(circle-slash) SFMCP 未配置";
  }
  statusBarItem.show();
}

// 扩展激活：注册命令、写配置、启动服务
function activate(context) {
  const startCommand = vscode.commands.registerCommand(
    "salesforceMcp.startServer",
    async () => {
      if (serverProcess) {
        vscode.window.showInformationMessage("Salesforce MCP 服务已在运行。");
        return;
      }

      const outputChannel = vscode.window.createOutputChannel("Salesforce MCP");
      outputChannel.show(true);

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || "";
      const { alias: sfOrgAliasStr, source: orgAliasSource } =
        getEffectiveOrgAliasWithSource(workspaceRoot);
      logOrgAliasDebug(workspaceRoot, sfOrgAliasStr, orgAliasSource);

      const config = vscode.workspace.getConfiguration("salesforceMcp");
      const sfAuthModeStr = config.get("sfAuthMode") || "";
      const sfCliPathStr = config.get("sfCliPath") || "";
      const sfInstanceUrlStr = config.get("sfInstanceUrl") || "";
      const sfAccessTokenStr = config.get("sfAccessToken") || "";

      const envVars = { ...process.env };
      if (sfAuthModeStr) envVars.SF_AUTH_MODE = sfAuthModeStr;
      if (sfOrgAliasStr) envVars.SF_ORG_ALIAS = sfOrgAliasStr;
      if (sfCliPathStr) envVars.SF_CLI_PATH = sfCliPathStr;
      if (sfInstanceUrlStr) envVars.SF_INSTANCE_URL = sfInstanceUrlStr;
      if (sfAccessTokenStr) envVars.SF_ACCESS_TOKEN = sfAccessTokenStr;

      const entryPathStr = getBundledMcpPathStr(context);
      const mcpCwdPathStr = path.dirname(entryPathStr);

      if (!fs.existsSync(entryPathStr)) {
        vscode.window.showErrorMessage(
          "未找到 MCP 入口 server/dist/mcp.js，请执行 npm run build:server 后重试。"
        );
        return;
      }

      try {
        serverProcess = cp.spawn(process.execPath, [entryPathStr], {
          cwd: mcpCwdPathStr,
          env: envVars,
          shell: false
        });
      } catch (err) {
        vscode.window.showErrorMessage(`启动 Salesforce MCP 失败: ${err}`);
        outputChannel.appendLine(`启动失败: ${err}`);
        return;
      }

      serverProcess.stdout.on("data", (data) => {
        outputChannel.appendLine(`[stdout] ${data.toString()}`);
      });
      serverProcess.stderr.on("data", (data) => {
        outputChannel.appendLine(`[stderr] ${data.toString()}`);
      });
      serverProcess.on("exit", (code, signal) => {
        outputChannel.appendLine(
          `Salesforce MCP 进程退出，code=${code}, signal=${signal}`
        );
        serverProcess = null;
      });

      vscode.window.showInformationMessage(
        "Salesforce MCP 服务已启动。"
      );
    }
  );

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(startCommand);

  // 已有有效 Org 时尝试写入；返回 true 表示已就绪
  function tryWriteWhenOrgReady() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return false;
    const { alias } = getEffectiveOrgAliasWithSource(folder.uri.fsPath);
    if (!alias) return false;
    const { written, unchanged } = writeMcpConfig(context);
    if (written) {
      showConfigUpdated("MCP 配置已写入。");
    }
    updateStatusBar();
    return written || unchanged;
  }

  if (vscode.workspace.workspaceFolders?.[0]) {
    if (!tryWriteWhenOrgReady()) {
      // 尚无 Org：每 5 秒重试，直到写入成功
      const intervalMs = 5000;
      const retryTimer = setInterval(() => {
        if (tryWriteWhenOrgReady()) {
          clearInterval(retryTimer);
        }
      }, intervalMs);
      context.subscriptions.push({
        dispose() {
          clearInterval(retryTimer);
        }
      });
    }
  }
  updateStatusBar();

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration("salesforceMcp") || !vscode.workspace.workspaceFolders?.[0]) {
      return;
    }
    const { written, unchanged } = writeMcpConfig(context);
    if (unchanged) {
      updateStatusBar();
      return;
    }
    if (written) {
      showConfigUpdated("MCP 配置已更新。");
    }
    updateStatusBar();
  });
  context.subscriptions.push(configListener);

  const folderListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    if (vscode.workspace.workspaceFolders?.[0]) {
      const { written, unchanged } = writeMcpConfig(context);
      if (unchanged) {
        updateStatusBar();
        return;
      }
      if (written) {
        showConfigUpdated("MCP 配置已更新。");
      }
    }
    updateStatusBar();
  });
  context.subscriptions.push(folderListener);

  // 监听官方 SF 插件的 target-org：连上 org 或切换 org 后再写入 MCP 配置
  const sfConfigWatcher = vscode.workspace.createFileSystemWatcher("**/.sf/config.json");
  const syncMcpOnSfConfigChange = () => {
    if (!vscode.workspace.workspaceFolders?.[0]) return;
    const { alias } = getEffectiveOrgAliasWithSource(
      vscode.workspace.workspaceFolders[0].uri.fsPath
    );
    if (!alias) return;
    const { written, unchanged } = writeMcpConfig(context);
    if (unchanged) {
      updateStatusBar();
      return;
    }
    if (written) {
      showConfigUpdated("检测到目标 Org 已切换，MCP 配置已更新。");
    }
    updateStatusBar();
  };
  context.subscriptions.push(sfConfigWatcher.onDidChange(syncMcpOnSfConfigChange));
  context.subscriptions.push(sfConfigWatcher.onDidCreate(syncMcpOnSfConfigChange));
  context.subscriptions.push(sfConfigWatcher);

  vscode.commands.executeCommand("salesforceMcp.startServer");
}

// 扩展停用：结束 MCP 子进程
function deactivate() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

module.exports = { activate, deactivate };