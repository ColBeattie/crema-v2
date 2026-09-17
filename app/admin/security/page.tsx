"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  Clock,
  Globe,
  Monitor,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ShieldCheck,
  ShieldOff,
  Filter,
} from "lucide-react";
import { checkIsAdmin } from "@/app/admin/users/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ───────────────────────────────────────────────────

interface SecurityAlert {
  id: string;
  user_id: string;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  created_at: string;
}

interface AnalysisAlert {
  id: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  userId: string;
  userEmail: string;
  userName?: string;
  details?: Record<string, unknown>;
}

interface SecurityAnalysisSummary {
  totalUsers: number;
  usersWithMfa: number;
  usersWithoutMfa: number;
  adminUsersWithoutMfa: number;
  usersWithOldPasswords: number;
  inactiveUsers: number;
  alerts: AnalysisAlert[];
}

interface LoginAttempt {
  id: string;
  user_id: string | null;
  email: string;
  ip_address: string;
  user_agent: string | null;
  country: string | null;
  city: string | null;
  success: boolean;
  failure_reason: string | null;
  mfa_used: boolean;
  created_at: string;
}

interface KnownIp {
  id: string;
  user_id: string;
  ip_address: string;
  country: string | null;
  city: string | null;
  trusted: boolean;
  login_count: number;
  first_seen_at: string;
  last_seen_at: string;
  trusted_by: string | null;
  trusted_at: string | null;
}

interface UserOption {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

type TabKey = "alerts" | "logins" | "ips";

// ── Helpers ─────────────────────────────────────────────────

function severityColor(severity: string) {
  switch (severity) {
    case "critical":
      return "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800";
    case "high":
      return "bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 border-orange-200 dark:border-orange-800";
    case "medium":
      return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800";
    case "low":
      return "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800";
    default:
      return "bg-muted text-foreground";
  }
}

function severityDot(severity: string) {
  switch (severity) {
    case "critical":
      return "bg-red-500";
    case "high":
      return "bg-orange-500";
    case "medium":
      return "bg-yellow-500";
    case "low":
      return "bg-blue-500";
    default:
      return "bg-gray-500";
  }
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Component ───────────────────────────────────────────────

export default function SecurityDashboard() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("alerts");

  // Alerts state
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertsPage, setAlertsPage] = useState(1);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsSeverityFilter, setAlertsSeverityFilter] = useState<string>("");
  const [alertsAckFilter, setAlertsAckFilter] = useState<string>("");

  // Login attempts state
  const [logins, setLogins] = useState<LoginAttempt[]>([]);
  const [loginsTotal, setLoginsTotal] = useState(0);
  const [loginsPage, setLoginsPage] = useState(1);
  const [loginsLoading, setLoginsLoading] = useState(false);
  const [loginsSearch, setLoginsSearch] = useState("");
  const [loginsSuccessFilter, setLoginsSuccessFilter] = useState<string>("");

  // Known IPs state
  const [ips, setIps] = useState<KnownIp[]>([]);
  const [ipsTotal, setIpsTotal] = useState(0);
  const [ipsPage, setIpsPage] = useState(1);
  const [ipsLoading, setIpsLoading] = useState(false);
  const [ipsUserFilter, setIpsUserFilter] = useState<string>("");
  const [ipsTrustFilter, setIpsTrustFilter] = useState<string>("");

  // Users list for filters
  const [users, setUsers] = useState<UserOption[]>([]);

  // Security analysis state
  const [analysisSummary, setAnalysisSummary] =
    useState<SecurityAnalysisSummary | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const PAGE_SIZE = 25;

  // ── Data Loaders ────────────────────────────────────────

  const loadUsers = async () => {
    try {
      const res = await fetch("/api/admin/security/users");
      const data = await res.json();
      if (res.ok) {
        setUsers(data.users || []);
      }
    } catch {}
  };

  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((alertsPage - 1) * PAGE_SIZE));
      if (alertsSeverityFilter) params.set("severity", alertsSeverityFilter);
      if (alertsAckFilter) params.set("acknowledged", alertsAckFilter);

      const res = await fetch(`/api/admin/security/alerts?${params}`);
      const data = await res.json();

      if (res.ok) {
        setAlerts(data.alerts || []);
        setAlertsTotal(data.total || 0);
      }
    } catch {
    } finally {
      setAlertsLoading(false);
    }
  }, [alertsPage, alertsSeverityFilter, alertsAckFilter, PAGE_SIZE]);

  const loadLogins = useCallback(async () => {
    setLoginsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((loginsPage - 1) * PAGE_SIZE));
      if (loginsSearch) params.set("email", loginsSearch);
      if (loginsSuccessFilter) params.set("success", loginsSuccessFilter);

      const res = await fetch(`/api/admin/security/login-attempts?${params}`);
      const data = await res.json();

      if (res.ok) {
        setLogins(data.attempts || []);
        setLoginsTotal(data.total || 0);
      }
    } catch {
    } finally {
      setLoginsLoading(false);
    }
  }, [loginsPage, loginsSearch, loginsSuccessFilter, PAGE_SIZE]);

  const loadIps = useCallback(async () => {
    setIpsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((ipsPage - 1) * PAGE_SIZE));
      if (ipsUserFilter) params.set("userId", ipsUserFilter);
      if (ipsTrustFilter) params.set("trusted", ipsTrustFilter);

      const res = await fetch(`/api/admin/security/known-ips?${params}`);
      const data = await res.json();

      if (res.ok) {
        setIps(data.ips || []);
        setIpsTotal(data.total || 0);
      }
    } catch {
    } finally {
      setIpsLoading(false);
    }
  }, [ipsPage, ipsUserFilter, ipsTrustFilter, PAGE_SIZE]);

  // ── Init ────────────────────────────────────────────────

  useEffect(() => {
    document.title = "Security Dashboard";
    const initPage = async () => {
      try {
        const adminStatus = await checkIsAdmin();
        setIsAdmin(adminStatus);
        if (!adminStatus) {
          router.push("/");
          return;
        }
        loadUsers();
      } catch {
        router.push("/");
      }
    };
    initPage();
  }, [router]);

  useEffect(() => {
    if (isAdmin) {
      loadAlerts();
      const loadAnalysis = async () => {
        setAnalysisLoading(true);
        try {
          const res = await fetch("/api/admin/security/analysis");
          const data = await res.json();
          if (res.ok) {
            setAnalysisSummary(data);
          }
        } catch {
        } finally {
          setAnalysisLoading(false);
        }
      };
      loadAnalysis();
    }
  }, [isAdmin, loadAlerts]);

  useEffect(() => {
    if (isAdmin) loadAlerts();
  }, [isAdmin, alertsPage, alertsSeverityFilter, alertsAckFilter, loadAlerts]);

  useEffect(() => {
    if (isAdmin && activeTab === "logins") loadLogins();
  }, [
    isAdmin,
    activeTab,
    loginsPage,
    loginsSearch,
    loginsSuccessFilter,
    loadLogins,
  ]);

  useEffect(() => {
    if (isAdmin && activeTab === "ips") loadIps();
  }, [isAdmin, activeTab, ipsPage, ipsUserFilter, ipsTrustFilter, loadIps]);

  // ── Actions ─────────────────────────────────────────────

  const handleAcknowledgeAlert = async (alertId: string) => {
    setActionLoading(alertId);
    try {
      const res = await fetch("/api/admin/security/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId }),
      });

      if (res.ok) {
        await loadAlerts();
      }
    } catch {
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleTrust = async (ipId: string, currentlyTrusted: boolean) => {
    setActionLoading(ipId);
    try {
      const res = await fetch("/api/admin/security/known-ips", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipId,
          action: currentlyTrusted ? "untrust" : "trust",
        }),
      });

      if (res.ok) {
        await loadIps();
      }
    } catch {
    } finally {
      setActionLoading(null);
    }
  };

  // ── Pagination helpers ──────────────────────────────────

  const alertsTotalPages = Math.ceil(alertsTotal / PAGE_SIZE);
  const loginsTotalPages = Math.ceil(loginsTotal / PAGE_SIZE);
  const ipsTotalPages = Math.ceil(ipsTotal / PAGE_SIZE);

  // ── Loading/Auth states ─────────────────────────────────

  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) return null;

  // ── Render ──────────────────────────────────────────────

  const tabs: { key: TabKey; label: string; icon: typeof ShieldAlert }[] = [
    { key: "alerts", label: "Security Alerts", icon: ShieldAlert },
    { key: "logins", label: "Login Attempts", icon: Monitor },
    { key: "ips", label: "Known IPs", icon: Globe },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-red-500" />
          Security Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monitor login activity, security alerts, and known IP addresses
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-border">
        <nav className="flex gap-0 -mb-px overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                }}
                className={`
                  flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                  ${
                    isActive
                      ? "border-red-500 text-red-600 dark:text-red-400"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }
                `}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
                {tab.key === "alerts" && alertsTotal > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
                    {alertsTotal}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === "alerts" && (
        <AlertsTab
          alerts={alerts}
          total={alertsTotal}
          page={alertsPage}
          totalPages={alertsTotalPages}
          loading={alertsLoading}
          severityFilter={alertsSeverityFilter}
          ackFilter={alertsAckFilter}
          actionLoading={actionLoading}
          analysisSummary={analysisSummary}
          analysisLoading={analysisLoading}
          onPageChange={setAlertsPage}
          onSeverityFilterChange={(v) => {
            setAlertsSeverityFilter(v);
            setAlertsPage(1);
          }}
          onAckFilterChange={(v) => {
            setAlertsAckFilter(v);
            setAlertsPage(1);
          }}
          onAcknowledge={handleAcknowledgeAlert}
        />
      )}

      {activeTab === "logins" && (
        <LoginsTab
          logins={logins}
          total={loginsTotal}
          page={loginsPage}
          totalPages={loginsTotalPages}
          loading={loginsLoading}
          search={loginsSearch}
          successFilter={loginsSuccessFilter}
          onPageChange={setLoginsPage}
          onSearchChange={(v) => {
            setLoginsSearch(v);
            setLoginsPage(1);
          }}
          onSuccessFilterChange={(v) => {
            setLoginsSuccessFilter(v);
            setLoginsPage(1);
          }}
        />
      )}

      {activeTab === "ips" && (
        <IpsTab
          ips={ips}
          total={ipsTotal}
          page={ipsPage}
          totalPages={ipsTotalPages}
          loading={ipsLoading}
          userFilter={ipsUserFilter}
          trustFilter={ipsTrustFilter}
          users={users}
          actionLoading={actionLoading}
          onPageChange={setIpsPage}
          onUserFilterChange={(v) => {
            setIpsUserFilter(v);
            setIpsPage(1);
          }}
          onTrustFilterChange={(v) => {
            setIpsTrustFilter(v);
            setIpsPage(1);
          }}
          onToggleTrust={handleToggleTrust}
        />
      )}
    </div>
  );
}

// ── Alerts Tab ──────────────────────────────────────────────

function AlertsTab({
  alerts,
  total,
  page,
  totalPages,
  loading,
  severityFilter,
  ackFilter,
  actionLoading,
  analysisSummary,
  analysisLoading,
  onPageChange,
  onSeverityFilterChange,
  onAckFilterChange,
  onAcknowledge,
}: {
  alerts: SecurityAlert[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  severityFilter: string;
  ackFilter: string;
  actionLoading: string | null;
  analysisSummary: SecurityAnalysisSummary | null;
  analysisLoading: boolean;
  onPageChange: (p: number) => void;
  onSeverityFilterChange: (v: string) => void;
  onAckFilterChange: (v: string) => void;
  onAcknowledge: (id: string) => void;
}) {
  const [showAnalysisAlerts, setShowAnalysisAlerts] = useState(false);

  return (
    <div>
      {/* Security Overview */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Security Overview</CardTitle>
        </CardHeader>
        <CardContent>
          {analysisLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Analyzing security...
              </span>
            </div>
          ) : analysisSummary ? (
            <div>
              {/* Metrics Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {analysisSummary.usersWithMfa}
                  </div>
                  <div className="text-sm text-green-700 dark:text-green-300">
                    Users with MFA
                  </div>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4">
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                    {analysisSummary.usersWithoutMfa}
                  </div>
                  <div className="text-sm text-yellow-700 dark:text-yellow-300">
                    Users without MFA
                  </div>
                </div>
                <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4">
                  <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {analysisSummary.usersWithOldPasswords}
                  </div>
                  <div className="text-sm text-orange-700 dark:text-orange-300">
                    Old passwords
                  </div>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {analysisSummary.adminUsersWithoutMfa}
                  </div>
                  <div className="text-sm text-red-700 dark:text-red-300">
                    Admins without MFA
                  </div>
                </div>
              </div>

              {/* Analysis Alerts Toggle */}
              {analysisSummary.alerts.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowAnalysisAlerts(!showAnalysisAlerts)}
                    className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors"
                  >
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    {analysisSummary.alerts.length} security finding
                    {analysisSummary.alerts.length !== 1 ? "s" : ""} detected
                    <ChevronRight
                      className={`h-4 w-4 transition-transform ${showAnalysisAlerts ? "rotate-90" : ""}`}
                    />
                  </button>

                  {showAnalysisAlerts && (
                    <div className="mt-3 space-y-2">
                      {analysisSummary.alerts.map((alert) => (
                        <div
                          key={alert.id}
                          className={`p-3 rounded-lg border ${severityColor(alert.severity)}`}
                        >
                          <div className="flex items-start gap-2">
                            <AlertTriangle
                              className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                                alert.severity === "critical"
                                  ? "text-red-500"
                                  : alert.severity === "high"
                                    ? "text-orange-500"
                                    : alert.severity === "medium"
                                      ? "text-yellow-500"
                                      : "text-blue-500"
                              }`}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-sm font-medium text-foreground">
                                  {alert.title}
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 text-xs font-medium rounded-full border ${severityColor(alert.severity)}`}
                                >
                                  {alert.severity}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {alert.description}
                              </p>
                              {alert.details && (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {alert.type === "password_age" &&
                                  alert.details.ageInDays ? (
                                    <span>
                                      Last updated:{" "}
                                      {String(alert.details.ageInDays)} days ago
                                    </span>
                                  ) : null}
                                  {alert.type === "inactive_user" &&
                                  alert.details.neverSignedIn ? (
                                    <span>Account created but never used</span>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {analysisSummary.alerts.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <ShieldCheck className="h-4 w-4" />
                  No security findings detected
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              Unable to load security analysis
            </div>
          )}
        </CardContent>
      </Card>

      {/* Real-time Alerts */}
      <h3 className="text-md font-semibold text-foreground mb-3">
        Real-time Alerts
      </h3>

      {/* Filters */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select
            value={severityFilter || "all"}
            onValueChange={(v) => onSeverityFilterChange(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Severities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Select
          value={ackFilter || "all"}
          onValueChange={(v) => onAckFilterChange(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="All Alerts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Alerts</SelectItem>
            <SelectItem value="false">Unacknowledged</SelectItem>
            <SelectItem value="true">Acknowledged</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-sm text-muted-foreground self-center">
          {total} alert{total !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden py-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No security alerts found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Severity
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Alert
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {alerts.map((alert) => (
                  <tr key={alert.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border ${severityColor(alert.severity)}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${severityDot(alert.severity)}`}
                        />
                        {alert.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-foreground">
                        {alert.title}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 max-w-md truncate">
                        {alert.description}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-muted-foreground font-mono">
                        {alert.alert_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {formatDate(alert.created_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {alert.acknowledged_at ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                          <CheckCircle className="h-3.5 w-3.5" />
                          Acknowledged
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <Clock className="h-3.5 w-3.5" />
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!alert.acknowledged_at && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onAcknowledge(alert.id)}
                          disabled={actionLoading === alert.id}
                          className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                        >
                          {actionLoading === alert.id ? "..." : "Acknowledge"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      </Card>
    </div>
  );
}

// ── Logins Tab ──────────────────────────────────────────────

function LoginsTab({
  logins,
  total,
  page,
  totalPages,
  loading,
  search,
  successFilter,
  onPageChange,
  onSearchChange,
  onSuccessFilterChange,
}: {
  logins: LoginAttempt[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  search: string;
  successFilter: string;
  onPageChange: (p: number) => void;
  onSearchChange: (v: string) => void;
  onSuccessFilterChange: (v: string) => void;
}) {
  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by email..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select
          value={successFilter || "all"}
          onValueChange={(v) => onSuccessFilterChange(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Attempts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Attempts</SelectItem>
            <SelectItem value="true">Successful</SelectItem>
            <SelectItem value="false">Failed</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-sm text-muted-foreground self-center">
          {total} attempt{total !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden py-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : logins.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Monitor className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No login attempts found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                    IP Address
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                    Location
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                    MFA
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logins.map((login) => (
                  <tr key={login.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      {login.success ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                          <CheckCircle className="h-3.5 w-3.5" />
                          Success
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-foreground">
                        {login.email}
                      </span>
                      {login.failure_reason && (
                        <div className="text-xs text-red-500 dark:text-red-400 mt-0.5">
                          {login.failure_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-xs font-mono text-muted-foreground">
                        {login.ip_address}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {[login.city, login.country]
                          .filter(Boolean)
                          .join(", ") || "-"}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {login.mfa_used ? (
                        <ShieldCheck className="h-4 w-4 text-green-500" />
                      ) : (
                        <ShieldOff className="h-4 w-4 text-muted-foreground" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">
                        {formatDate(login.created_at)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      </Card>
    </div>
  );
}

// ── IPs Tab ─────────────────────────────────────────────────

function IpsTab({
  ips,
  total,
  page,
  totalPages,
  loading,
  userFilter,
  trustFilter,
  users,
  actionLoading,
  onPageChange,
  onUserFilterChange,
  onTrustFilterChange,
  onToggleTrust,
}: {
  ips: KnownIp[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  userFilter: string;
  trustFilter: string;
  users: UserOption[];
  actionLoading: string | null;
  onPageChange: (p: number) => void;
  onUserFilterChange: (v: string) => void;
  onTrustFilterChange: (v: string) => void;
  onToggleTrust: (ipId: string, currentlyTrusted: boolean) => void;
}) {
  const getUserDisplay = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return userId.slice(0, 8) + "...";
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
    return name || user.email;
  };

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select
            value={userFilter || "all"}
            onValueChange={(v) => onUserFilterChange(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {[u.firstName, u.lastName].filter(Boolean).join(" ") ||
                    u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Select
          value={trustFilter || "all"}
          onValueChange={(v) => onTrustFilterChange(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All IPs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All IPs</SelectItem>
            <SelectItem value="true">Trusted</SelectItem>
            <SelectItem value="false">Untrusted</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-sm text-muted-foreground self-center">
          {total} known IP{total !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden py-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : ips.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Globe className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No known IPs found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    IP Address
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                    Location
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                    Logins
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                    Last Seen
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Trusted
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ips.map((ip) => (
                  <tr key={ip.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <span className="text-sm font-mono text-foreground">
                        {ip.ip_address}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-foreground">
                        {getUserDisplay(ip.user_id)}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {[ip.city, ip.country].filter(Boolean).join(", ") ||
                          "-"}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-sm text-foreground">
                        {ip.login_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {formatDate(ip.last_seen_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {ip.trusted ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Trusted
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                          <ShieldOff className="h-3.5 w-3.5" />
                          Untrusted
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onToggleTrust(ip.id, ip.trusted)}
                        disabled={actionLoading === ip.id}
                        className={
                          ip.trusted
                            ? "text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                            : "text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300"
                        }
                      >
                        {actionLoading === ip.id
                          ? "..."
                          : ip.trusted
                            ? "Untrust"
                            : "Trust"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      </Card>
    </div>
  );
}

// ── Pagination ──────────────────────────────────────────────

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="px-4 py-3 border-t border-border flex items-center justify-between">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page === 1}
      >
        <ChevronLeft className="h-4 w-4" />
        Previous
      </Button>
      <span className="text-sm text-foreground">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
