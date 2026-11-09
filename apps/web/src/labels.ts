export const runStatusLabel: Record<string, string> = {
  CREATED: "待生成计划",
  PLANNING: "待审批",
  READY: "待启动",
  QUEUED: "排队中",
  RUNNING: "运行中",
  COMPLETED: "已完成",
  FAILED: "执行中断",
};

export const verdictLabel: Record<string, string> = {
  PASS: "通过",
  FAIL: "未通过",
  UNCERTAIN: "无法判定",
  NOT_EVALUATED: "暂无结论",
};

export const severityLabel: Record<string, string> = { LOW: "低", MEDIUM: "中", HIGH: "高", CRITICAL: "严重" };

export const classificationLabel: Record<string, string> = {
  REAL_BUG: "真实缺陷",
  AUTOMATION_ERROR: "自动化错误",
  FLAKY: "偶发问题",
  ENVIRONMENT_ERROR: "环境问题",
  UNCERTAIN: "无法判定",
};

export const categoryLabel: Record<string, string> = {
  FUNCTIONAL: "功能",
  UI: "界面",
  NETWORK: "网络",
  CONSOLE: "控制台",
  AUTH: "登录鉴权",
  AUTOMATION: "自动化",
  ENVIRONMENT: "环境",
  UNKNOWN: "未知",
};

export const evidenceTypeLabel: Record<string, string> = {
  SCREENSHOT: "页面截图",
  CONSOLE_ERROR: "控制台错误",
  NETWORK_FAILURE: "网络异常",
  DOM_STATE: "页面结构",
  VISIBLE_TEXT: "页面文字",
  PLAYWRIGHT_ERROR: "浏览器错误",
  ASSERTION: "断言",
  TRACE: "执行轨迹",
};

const failureReasons: Array<[string, string]> = [
  ["WORKER_LOST", "执行进程中断，任务已停止，未自动重跑"],
  ["BUDGET_EXHAUSTED", "超出操作步数或模型调用上限"],
  ["AGENT_FAILED", "Agent 未能完成操作"],
  ["PAUSED", "Agent 请求暂停"],
  ["ESCALATED", "Agent 请求人工介入"],
  ["OUTCOME_REJECTED", "结果未通过校验，未保存"],
  ["EXECUTOR_ERROR", "执行出错"],
  ["MISSING_ASSERTION", "有步骤缺少判定"],
];

export function failureReasonLabel(reason: string): string {
  const match = failureReasons.find(([code]) => reason.startsWith(code));
  return match ? `${match[1]}（${reason}）` : reason;
}

const apiErrors: Record<string, string> = {
  RUN_NOT_FOUND: "找不到这次运行",
  RUN_ALREADY_STARTED: "这次运行已经开始，不能再修改",
  PLAN_APPROVAL_REQUIRED: "计划需要先通过审批",
  PLAN_VERSION_CONFLICT: "计划已被更新，请刷新后再试",
  INVALID_TARGET_URL: "目标网址格式不正确",
  INVALID_RUN_INPUT: "请检查目标网址和测试目标",
  LLM_PROVIDER_NOT_CONFIGURED: "模型尚未配置",
  DATABASE_UNAVAILABLE: "数据库暂时不可用",
  BUG_NOT_FOUND: "找不到这份缺陷报告",
};

export function apiErrorLabel(code: string): string {
  return apiErrors[code] ?? code;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
