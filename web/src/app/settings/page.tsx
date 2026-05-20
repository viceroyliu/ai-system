"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api";
import type { ApiModels, ApiStatus } from "@/lib/types";

export default function SettingsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [models, setModels] = useState<ApiModels | null>(null);
  const [currentModel, setCurrentModel] = useState("");
  const [lmUrl, setLmUrl] = useState("http://localhost:1234/v1");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([apiClient.getStatus(), apiClient.getModels()]).then(([s, m]) => {
      setStatus(s);
      setModels(m);
      setCurrentModel(m.current || "");
    }).catch(() => {});
  }, []);

  async function handleSave() {
    try {
      if (currentModel) await apiClient.setModel(currentModel);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
  }

  return (
    <div className="app-layout">
      {/* ====== SIDEBAR ====== */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark"><span>SB</span></div>
          <div>
            <div className="logo-text">SecondBrain</div>
            <div className="logo-sub">AI System · v3.0</div>
          </div>
        </div>

        <div className="search-box" onClick={() => router.push("/search")}>
          <span>🔍 搜索知识库...</span>
          <span className="key">⌘K</span>
        </div>

        <div className="nav-section">
          <div className="nav-label">Main</div>
          <div className="nav-item" onClick={() => router.push("/")}>
            <span>🏠</span> 概览
          </div>
          <div className="nav-item" onClick={() => router.push("/chat")}>
            <span>💬</span> AI 对话
          </div>
          <div className="nav-item" onClick={() => router.push("/search")}>
            <span>🔍</span> 搜索
          </div>
          <div className="nav-item active">
            <span>⚙️</span> 设置
          </div>
        </div>

        <div className="nav-section">
          <div className="nav-label">数据源</div>
          <div className="nav-item">
            <span>🗂️</span> Notion
            <span className="nav-dot green"></span>
          </div>
          <div className="nav-item">
            <span>📁</span> 本地笔记
            <span className="nav-dot green"></span>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="model-select-label">当前模型</div>
          <select className="model-select" value={currentModel} onChange={(e) => setCurrentModel(e.target.value)}>
            {(models?.models || []).map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </div>
      </aside>

      {/* ====== MAIN ====== */}
      <main className="main">
        <div className="topbar">
          <div className="topbar-left">
            <h1>⚙️ 设置</h1>
            <div className="subtitle">模型配置 · 同步设置 · API 管理</div>
          </div>
          <div className="topbar-right">
            <button className="btn-primary" onClick={handleSave}>
              {saved ? "✓ 已保存" : "💾 保存设置"}
            </button>
          </div>
        </div>

        <div className="content">
          <div style={{ maxWidth: "640px", display: "flex", flexDirection: "column", gap: "16px" }}>

            {/* Model settings */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">🤖 模型配置</span>
              </div>
              <div className="card-body">
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--sb-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
                    LM Studio API 地址
                  </div>
                  <input
                    type="text"
                    value={lmUrl}
                    onChange={(e) => setLmUrl(e.target.value)}
                    style={{
                      width: "100%",
                      background: "var(--sb-muted)",
                      border: "1px solid var(--sb-border)",
                      borderRadius: "8px",
                      padding: "8px 12px",
                      fontSize: "13px",
                      color: "var(--sb-text)",
                      fontFamily: "inherit",
                      outline: "none",
                    }}
                    placeholder="http://localhost:1234/v1"
                  />
                  <div style={{ fontSize: "10px", color: "var(--sb-text-muted)", marginTop: "4px" }}>
                    LM Studio 的 OpenAI-compatible API 地址
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--sb-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
                    默认模型
                  </div>
                  <select
                    className="model-select"
                    value={currentModel}
                    onChange={(e) => setCurrentModel(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    {(models?.models || []).length === 0 && (
                      <option value="">无可用模型（检查 LM Studio 是否运行）</option>
                    )}
                    {(models?.models || []).map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: "10px", color: "var(--sb-text-muted)", marginTop: "4px" }}>
                    当前: {currentModel || "未选择"} · 共 {(models?.models || []).length} 个可用模型
                  </div>
                </div>
              </div>
            </div>

            {/* Sync settings */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">🔄 同步设置</span>
              </div>
              <div className="card-body">
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {[
                    { label: "自动同步", desc: "每 5 分钟检查 Notion 更新", enabled: true },
                    { label: "AI 自动命名", desc: "为无标题的闪念/复盘生成标题", enabled: true },
                    { label: "同步到本地", desc: "将 Notion 页面保存到本地笔记", enabled: false },
                  ].map((item) => (
                    <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--sb-text)" }}>{item.label}</div>
                        <div style={{ fontSize: "11px", color: "var(--sb-text-muted)" }}>{item.desc}</div>
                      </div>
                      <div style={{
                        width: "36px", height: "20px", borderRadius: "10px",
                        background: item.enabled ? "var(--sb-primary)" : "var(--sb-border)",
                        position: "relative", cursor: "pointer", transition: "background 0.2s",
                      }}>
                        <div style={{
                          width: "16px", height: "16px", borderRadius: "50%",
                          background: "white",
                          position: "absolute",
                          top: "2px",
                          left: item.enabled ? "18px" : "2px",
                          transition: "left 0.2s",
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Notion databases */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">🗂️ Notion 数据库</span>
              </div>
              <div className="card-body">
                {(status?.databases || []).map((db) => (
                  <div key={db} className="db-item">
                    <span className="db-name">📋 {db}</span>
                    <span style={{ fontSize: "10px", color: "var(--sb-text-muted)" }}>
                      <span style={{ color: "var(--sb-success)", marginRight: "3px" }}>●</span>
                      已连接
                    </span>
                  </div>
                ))}
                <div style={{ marginTop: "12px", padding: "10px", background: "var(--sb-muted)", borderRadius: "8px", fontSize: "11px", color: "var(--sb-text-muted)" }}>
                  💡 如需修改数据库配置，请编辑 <code style={{ background: "var(--sb-border)", padding: "1px 4px", borderRadius: "3px" }}>config/notion.yaml</code>
                </div>
              </div>
            </div>

            {/* System info */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">ℹ️ 系统信息</span>
              </div>
              <div className="card-body">
                {[
                  { label: "向量文档", val: `${status?.documents ?? "—"} 条` },
                  { label: "Collection", val: (status?.collections || []).join(", ") || "—" },
                  { label: "最后同步", val: status?.last_sync ? status.last_sync.replace("T", " ").slice(0, 19) : "从未" },
                  { label: "后端服务", val: status?.service_running ? "运行中 (localhost:5100)" : "已停止" },
                  { label: "同步服务", val: status?.service_running ? "自动运行" : "已停止" },
                ].map((row) => (
                  <div key={row.label} className="status-row">
                    <span className="status-label">{row.label}</span>
                    <span className="status-val">{row.val}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
