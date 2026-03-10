"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Database,
  RefreshCw,
  Plus,
  Clock,
  Calendar,
  HardDrive,
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trash2,
  Download,
  Upload,
  Play,
  Pause,
  Settings,
  FileArchive,
  Lock,
  Zap,
  CalendarClock,
  BarChart3,
  Timer,
  Info,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ==================== TYPES ====================

interface BackupRecord {
  id: string;
  name: string;
  description?: string;
  type: string;
  status: string;
  fileName: string;
  filePath?: string;
  fileSize: number;
  checksum?: string;
  compressed: boolean;
  encrypted: boolean;
  scope: string;
  tables: string[];
  recordCount: number;
  retentionDays: number;
  warningCount: number;
  errorMessage?: string;
  triggeredBy: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface BackupSchedule {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  frequency: string;
  hour: number;
  minute: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  type: string;
  scope: string;
  retentionDays: number;
  compress: boolean;
  encrypt: boolean;
  lastRunAt?: string;
  lastRunStatus?: string;
  nextRunAt?: string;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  notifyChannels: string[];
}

interface BackupStats {
  totalBackups: number;
  totalSize: number;
  successfulBackups: number;
  failedBackups: number;
  lastBackup?: string;
  lastSuccessful?: string;
  avgBackupSize: number;
  upcomingScheduled?: string;
}

interface BackupListResponse {
  success: boolean;
  data: BackupRecord[];
  meta: {
    total: number;
    page: number;
    totalPages: number;
    hasNextPage: boolean;
  };
  stats: BackupStats;
}

// ==================== CONSTANTS ====================

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: 'Pending', color: 'bg-gray-500', icon: Clock },
  running: { label: 'Running', color: 'bg-blue-500 animate-pulse', icon: RefreshCw },
  completed: { label: 'Completed', color: 'bg-green-500', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-red-500', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'bg-gray-400', icon: AlertTriangle },
};

const FREQUENCY_LABELS: Record<string, string> = {
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ==================== MAIN COMPONENT ====================

export function BackupPanel() {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
  const [stats, setStats] = useState<BackupStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [activeTab, setActiveTab] = useState('backups');

  // Dialogs
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupRecord | null>(null);

  // New backup form
  const [newBackup, setNewBackup] = useState({
    name: '',
    description: '',
    type: 'full',
    scope: 'database',
    retentionDays: 30,
    compress: true,
    encrypt: true,
  });

  // New schedule form
  const [newSchedule, setNewSchedule] = useState({
    name: '',
    description: '',
    frequency: 'daily',
    hour: 2,
    minute: 0,
    dayOfWeek: 0,
    dayOfMonth: 1,
    type: 'full',
    scope: 'database',
    retentionDays: 30,
    compress: true,
    encrypt: true,
    notifyOnSuccess: true,
    notifyOnFailure: true,
  });

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [backupsRes, schedulesRes] = await Promise.all([
        fetch(`/api/backup?page=${page}&limit=10`),
        fetch('/api/backup/schedules'),
      ]);

      const backupsData: BackupListResponse = await backupsRes.json();
      const schedulesData = await schedulesRes.json();

      if (backupsData.success) {
        setBackups(backupsData.data);
        setStats(backupsData.stats);
        setTotalPages(backupsData.meta.totalPages);
      }

      if (schedulesData.success) {
        setSchedules(schedulesData.data);
      }
    } catch (error) {
      console.error('[Backup] Fetch error:', error);
      toast.error('Failed to load backup data');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Create backup
  const handleCreateBackup = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBackup),
      });

      const data = await res.json();

      if (data.success) {
        toast.success('Backup started successfully');
        setShowCreateDialog(false);
        resetBackupForm();
        fetchData();
      } else {
        toast.error(data.error || 'Failed to create backup');
      }
    } catch (error) {
      console.error('[Backup] Create error:', error);
      toast.error('Failed to create backup');
    } finally {
      setCreating(false);
    }
  };

  // Create schedule
  const handleCreateSchedule = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/backup/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSchedule),
      });

      const data = await res.json();

      if (data.success) {
        toast.success('Schedule created successfully');
        setShowScheduleDialog(false);
        resetScheduleForm();
        fetchData();
      } else {
        toast.error(data.error || 'Failed to create schedule');
      }
    } catch (error) {
      console.error('[Schedule] Create error:', error);
      toast.error('Failed to create schedule');
    } finally {
      setCreating(false);
    }
  };

  // Delete backup
  const handleDeleteBackup = async () => {
    if (!selectedBackup) return;

    try {
      const res = await fetch(`/api/backup?id=${selectedBackup.id}`, {
        method: 'DELETE',
      });

      const data = await res.json();

      if (data.success) {
        toast.success('Backup deleted successfully');
        setShowDeleteDialog(false);
        setSelectedBackup(null);
        fetchData();
      } else {
        toast.error(data.error || 'Failed to delete backup');
      }
    } catch (error) {
      console.error('[Backup] Delete error:', error);
      toast.error('Failed to delete backup');
    }
  };

  // Toggle schedule
  const handleToggleSchedule = async (scheduleId: string) => {
    try {
      const res = await fetch('/api/backup/schedules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: scheduleId, action: 'toggle' }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(data.data.isActive ? 'Schedule activated' : 'Schedule paused');
        fetchData();
      } else {
        toast.error(data.error || 'Failed to toggle schedule');
      }
    } catch (error) {
      console.error('[Schedule] Toggle error:', error);
      toast.error('Failed to toggle schedule');
    }
  };

  // Trigger schedule
  const handleTriggerSchedule = async (scheduleId: string) => {
    try {
      const res = await fetch('/api/backup/schedules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: scheduleId, action: 'trigger' }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success('Backup triggered successfully');
        fetchData();
      } else {
        toast.error(data.error || 'Failed to trigger backup');
      }
    } catch (error) {
      console.error('[Schedule] Trigger error:', error);
      toast.error('Failed to trigger backup');
    }
  };

  // Restore backup
  const handleRestoreBackup = async () => {
    if (!selectedBackup) return;

    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupId: selectedBackup.id,
          restoreMode: 'replace',
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success('Restore operation started');
        setShowRestoreDialog(false);
        setSelectedBackup(null);
      } else {
        toast.error(data.error || 'Failed to start restore');
      }
    } catch (error) {
      console.error('[Restore] Error:', error);
      toast.error('Failed to start restore');
    }
  };

  // Reset forms
  const resetBackupForm = () => {
    setNewBackup({
      name: '',
      description: '',
      type: 'full',
      scope: 'database',
      retentionDays: 30,
      compress: true,
      encrypt: true,
    });
  };

  const resetScheduleForm = () => {
    setNewSchedule({
      name: '',
      description: '',
      frequency: 'daily',
      hour: 2,
      minute: 0,
      dayOfWeek: 0,
      dayOfMonth: 1,
      type: 'full',
      scope: 'database',
      retentionDays: 30,
      compress: true,
      encrypt: true,
      notifyOnSuccess: true,
      notifyOnFailure: true,
    });
  };

  // Format helpers
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  const getStatusBadge = (status: string) => {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
    const Icon = config.icon;
    return (
      <Badge variant="outline" className="gap-1">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Backup & Recovery</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowScheduleDialog(true)}>
            <CalendarClock className="h-4 w-4 mr-2" />
            New Schedule
          </Button>
          <Button size="sm" onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Backup Now
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Total Backups</div>
            <div className="text-xl font-bold">{stats.totalBackups}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Total Size</div>
            <div className="text-xl font-bold text-primary">{formatBytes(stats.totalSize)}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Successful</div>
            <div className="text-xl font-bold text-green-500">{stats.successfulBackups}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Failed</div>
            <div className="text-xl font-bold text-red-500">{stats.failedBackups}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Last Backup</div>
            <div className="text-sm font-bold">
              {stats.lastSuccessful ? formatDate(stats.lastSuccessful) : 'Never'}
            </div>
          </Card>
        </div>
      )}

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="h-9">
          <TabsTrigger value="backups" className="text-xs px-4">Backups</TabsTrigger>
          <TabsTrigger value="schedules" className="text-xs px-4">Schedules</TabsTrigger>
          <TabsTrigger value="settings" className="text-xs px-4">Settings</TabsTrigger>
        </TabsList>

        {/* Backups Tab */}
        <TabsContent value="backups" className="flex-1 min-h-0 mt-2">
          <Card className="h-full">
            <CardContent className="p-0 h-full">
              {loading ? (
                <div className="space-y-4 p-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : backups.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <Database className="h-12 w-12 mb-4 opacity-50" />
                  <p className="font-medium">No backups yet</p>
                  <p className="text-sm">Create your first backup to protect your data</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowCreateDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Backup
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-full">
                  <div className="divide-y divide-border">
                    {backups.map((backup) => (
                      <div key={backup.id} className="p-4 hover:bg-muted/30 transition-colors">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-medium">{backup.name}</span>
                              {getStatusBadge(backup.status)}
                              <Badge variant="outline" className="text-xs">
                                {backup.type}
                              </Badge>
                              {backup.encrypted && (
                                <Lock className="h-3 w-3 text-muted-foreground" />
                              )}
                              {backup.compressed && (
                                <FileArchive className="h-3 w-3 text-muted-foreground" />
                              )}
                            </div>
                            {backup.description && (
                              <p className="text-sm text-muted-foreground mb-1">{backup.description}</p>
                            )}
                            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                              <span className="flex items-center gap-1">
                                <HardDrive className="h-3 w-3" />
                                {formatBytes(backup.fileSize)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Database className="h-3 w-3" />
                                {backup.recordCount.toLocaleString()} records
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDate(backup.completedAt || backup.createdAt)}
                              </span>
                              {backup.errorMessage && (
                                <span className="flex items-center gap-1 text-red-500">
                                  <AlertTriangle className="h-3 w-3" />
                                  {backup.errorMessage}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                setSelectedBackup(backup);
                                setShowRestoreDialog(true);
                              }}
                              disabled={backup.status !== 'completed'}
                              title="Restore"
                            >
                              <Upload className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-500 hover:text-red-600"
                              onClick={() => {
                                setSelectedBackup(backup);
                                setShowDeleteDialog(true);
                              }}
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Schedules Tab */}
        <TabsContent value="schedules" className="flex-1 min-h-0 mt-2">
          <Card className="h-full">
            <CardContent className="p-0 h-full">
              {schedules.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <CalendarClock className="h-12 w-12 mb-4 opacity-50" />
                  <p className="font-medium">No schedules configured</p>
                  <p className="text-sm">Create a schedule for automated backups</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowScheduleDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Schedule
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-full">
                  <div className="divide-y divide-border">
                    {schedules.map((schedule) => (
                      <div key={schedule.id} className="p-4 hover:bg-muted/30 transition-colors">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium">{schedule.name}</span>
                              <Badge
                                variant={schedule.isActive ? "default" : "secondary"}
                                className="text-xs"
                              >
                                {schedule.isActive ? 'Active' : 'Paused'}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {FREQUENCY_LABELS[schedule.frequency]}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {String(schedule.hour).padStart(2, '0')}:{String(schedule.minute).padStart(2, '0')}
                              </span>
                              <span className="flex items-center gap-1">
                                <Timer className="h-3 w-3" />
                                Next: {schedule.nextRunAt ? formatDate(schedule.nextRunAt) : 'Not scheduled'}
                              </span>
                              <span className="flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                                {schedule.successCount} success
                              </span>
                              <span className="flex items-center gap-1">
                                <XCircle className="h-3 w-3 text-red-500" />
                                {schedule.failureCount} failed
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleTriggerSchedule(schedule.id)}
                              disabled={!schedule.isActive}
                              title="Run Now"
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleToggleSchedule(schedule.id)}
                              title={schedule.isActive ? 'Pause' : 'Activate'}
                            >
                              {schedule.isActive ? (
                                <Pause className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="flex-1 min-h-0 mt-2">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-base">Backup Settings</CardTitle>
              <CardDescription>Configure default backup behavior</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Default Retention (days)</Label>
                  <Input type="number" defaultValue={30} />
                </div>
                <div className="space-y-2">
                  <Label>Maximum Backups</Label>
                  <Input type="number" defaultValue={100} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable Compression</Label>
                  <p className="text-xs text-muted-foreground">Compress backups to save space</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable Encryption</Label>
                  <p className="text-xs text-muted-foreground">Encrypt backups with AES-256</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Notify on Success</Label>
                  <p className="text-xs text-muted-foreground">Get notified when backups complete</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Notify on Failure</Label>
                  <p className="text-xs text-muted-foreground">Get alerted when backups fail</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Backup Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create Backup
            </DialogTitle>
            <DialogDescription>
              Create a new database backup
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name (optional)</Label>
              <Input
                placeholder="backup-2024-01-01"
                value={newBackup.name}
                onChange={(e) => setNewBackup(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea
                placeholder="Backup description..."
                value={newBackup.description}
                onChange={(e) => setNewBackup(prev => ({ ...prev, description: e.target.value }))}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={newBackup.type} onValueChange={(v) => setNewBackup(prev => ({ ...prev, type: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full</SelectItem>
                    <SelectItem value="incremental">Incremental</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Scope</Label>
                <Select value={newBackup.scope} onValueChange={(v) => setNewBackup(prev => ({ ...prev, scope: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="database">Database</SelectItem>
                    <SelectItem value="config">Config</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Retention (days)</Label>
              <Input
                type="number"
                value={newBackup.retentionDays}
                onChange={(e) => setNewBackup(prev => ({ ...prev, retentionDays: parseInt(e.target.value) || 30 }))}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>Compress</Label>
              <Switch checked={newBackup.compress} onCheckedChange={(v) => setNewBackup(prev => ({ ...prev, compress: v }))} />
            </div>

            <div className="flex items-center justify-between">
              <Label>Encrypt</Label>
              <Switch checked={newBackup.encrypt} onCheckedChange={(v) => setNewBackup(prev => ({ ...prev, encrypt: v }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateBackup} disabled={creating}>
              {creating ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Database className="h-4 w-4 mr-2" />
              )}
              Create Backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Schedule Dialog */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5" />
              Create Schedule
            </DialogTitle>
            <DialogDescription>
              Set up automated backups
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                placeholder="Daily Database Backup"
                value={newSchedule.name}
                onChange={(e) => setNewSchedule(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select value={newSchedule.frequency} onValueChange={(v) => setNewSchedule(prev => ({ ...prev, frequency: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Time</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={newSchedule.hour}
                    onChange={(e) => setNewSchedule(prev => ({ ...prev, hour: parseInt(e.target.value) || 0 }))}
                    className="w-16"
                  />
                  <span className="text-muted-foreground">:</span>
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    value={newSchedule.minute}
                    onChange={(e) => setNewSchedule(prev => ({ ...prev, minute: parseInt(e.target.value) || 0 }))}
                    className="w-16"
                  />
                </div>
              </div>
            </div>

            {newSchedule.frequency === 'weekly' && (
              <div className="space-y-2">
                <Label>Day of Week</Label>
                <Select value={String(newSchedule.dayOfWeek)} onValueChange={(v) => setNewSchedule(prev => ({ ...prev, dayOfWeek: parseInt(v) }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS_OF_WEEK.map((day, i) => (
                      <SelectItem key={i} value={String(i)}>{day}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {newSchedule.frequency === 'monthly' && (
              <div className="space-y-2">
                <Label>Day of Month</Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={newSchedule.dayOfMonth}
                  onChange={(e) => setNewSchedule(prev => ({ ...prev, dayOfMonth: parseInt(e.target.value) || 1 }))}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Backup Type</Label>
                <Select value={newSchedule.type} onValueChange={(v) => setNewSchedule(prev => ({ ...prev, type: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full</SelectItem>
                    <SelectItem value="incremental">Incremental</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Retention (days)</Label>
                <Input
                  type="number"
                  value={newSchedule.retentionDays}
                  onChange={(e) => setNewSchedule(prev => ({ ...prev, retentionDays: parseInt(e.target.value) || 30 }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScheduleDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateSchedule} disabled={creating}>
              {creating ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CalendarClock className="h-4 w-4 mr-2" />
              )}
              Create Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Dialog */}
      <AlertDialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Restore Backup
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This will replace your current database with the backup from:
              </p>
              <p className="font-medium">
                {selectedBackup?.name} ({formatDate(selectedBackup?.completedAt)})
              </p>
              <p className="text-yellow-600 font-medium">
                Warning: This action cannot be undone!
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestoreBackup} className="bg-primary">
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Backup</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedBackup?.name}"? This will permanently remove the backup file and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteBackup} className="bg-red-500 hover:bg-red-600">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
