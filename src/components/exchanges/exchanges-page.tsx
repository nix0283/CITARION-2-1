"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SUPPORTED_EXCHANGES,
  EXCHANGE_GROUPS,
  getExchangeById,
  type ExchangeType,
  type Exchange,
} from "@/lib/exchanges";
import {
  Building2,
  Link2,
  Unlink,
  AlertTriangle,
  CheckCircle,
  Clock,
  Settings,
  Key,
  Loader2,
  RefreshCw,
  Plus,
  TestTube,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ConnectedAccount {
  id: string;
  exchangeId: string;
  exchangeType: ExchangeType;
  exchangeName: string;
  accountType: "DEMO" | "REAL";
  isActive: boolean;
  isTestnet: boolean;
  apiKey?: string;
  apiPassphrase?: string;
  lastSyncAt?: string;
  lastError?: string;
}

// Exchange icons/colors
const EXCHANGE_STYLES: Record<string, { color: string; bgColor: string }> = {
  binance: { color: "#F0B90B", bgColor: "#F0B90B20" },
  bybit: { color: "#F7A600", bgColor: "#F7A60020" },
  okx: { color: "#FFFFFF", bgColor: "#FFFFFF20" },
  bitget: { color: "#00D084", bgColor: "#00D08420" },
  bingx: { color: "#4285F4", bgColor: "#4285F420" },
};

export function ExchangesPage() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedExchangeId, setSelectedExchangeId] = useState<string>("binance");
  const [selectedExchangeType, setSelectedExchangeType] = useState<ExchangeType>("futures");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<ConnectedAccount | null>(null);

  // Form state
  const [formApiKey, setFormApiKey] = useState("");
  const [formApiSecret, setFormApiSecret] = useState("");
  const [formPassphrase, setFormPassphrase] = useState("");
  const [formTestnet, setFormTestnet] = useState(false);

  // Fetch accounts from API
  const fetchAccounts = useCallback(async () => {
    try {
      const response = await fetch("/api/exchange");
      if (response.ok) {
        const data = await response.json();
        setAccounts(data.accounts || []);
      }
    } catch (error) {
      console.error("Failed to fetch accounts:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Get connected account for exchange
  const getConnectedAccount = (exchangeId: string, type: ExchangeType) => {
    return accounts.find(
      (a) => a.exchangeId === exchangeId && a.exchangeType === type
    );
  };

  // Check if exchange is connected
  const isExchangeConnected = (exchangeId: string, type: ExchangeType) => {
    const account = getConnectedAccount(exchangeId, type);
    return account?.isActive && !account.lastError;
  };

  // Handle add exchange
  const handleAddExchange = (exchangeId: string, type: ExchangeType) => {
    const existing = getConnectedAccount(exchangeId, type);
    if (existing) {
      setSelectedAccount(existing);
      setShowSettingsDialog(true);
    } else {
      setSelectedExchangeId(exchangeId);
      setSelectedExchangeType(type);
      setFormApiKey("");
      setFormApiSecret("");
      setFormPassphrase("");
      setFormTestnet(false);
      setShowAddDialog(true);
    }
  };

  // Submit new connection
  const handleSubmit = async () => {
    if (!formApiKey || !formApiSecret) {
      toast.error("API Key и API Secret обязательны");
      return;
    }

    setIsSubmitting(true);

    try {
      const exchangeConfig = getExchangeById(selectedExchangeId, selectedExchangeType);
      
      const response = await fetch("/api/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchangeId: selectedExchangeId,
          exchangeType: selectedExchangeType,
          exchangeName: exchangeConfig?.displayName || selectedExchangeId,
          apiKey: formApiKey,
          apiSecret: formApiSecret,
          apiPassphrase: formPassphrase || null,
          isTestnet: formTestnet,
          accountType: "REAL",
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(data.message);
        setShowAddDialog(false);
        fetchAccounts();
        setFormApiKey("");
        setFormApiSecret("");
        setFormPassphrase("");
      } else {
        toast.error(data.error || "Ошибка подключения");
      }
    } catch (error) {
      toast.error("Ошибка соединения");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle account active
  const handleToggleActive = async (account: ConnectedAccount) => {
    try {
      const response = await fetch("/api/exchange", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: account.id,
          isActive: !account.isActive,
        }),
      });

      if (response.ok) {
        toast.success(account.isActive ? "Аккаунт отключён" : "Аккаунт активирован");
        fetchAccounts();
      }
    } catch (error) {
      toast.error("Ошибка");
    }
  };

  // Disconnect exchange
  const handleDisconnect = async (account: ConnectedAccount) => {
    if (!confirm(`Отключить ${account.exchangeName}?`)) return;

    try {
      const response = await fetch(`/api/exchange?id=${account.id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast.success("Биржа отключена");
        fetchAccounts();
      }
    } catch (error) {
      toast.error("Ошибка отключения");
    }
  };

  // Verify connection
  const handleVerify = async () => {
    if (!selectedAccount) return;

    setIsVerifying(true);

    try {
      const response = await fetch("/api/exchange/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: selectedAccount.id }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(data.message);
        fetchAccounts();
        setSelectedAccount((prev) =>
          prev
            ? {
                ...prev,
                lastSyncAt: new Date().toISOString(),
                lastError: undefined,
              }
            : null
        );
      } else {
        toast.error(data.message || "Ошибка верификации");
      }
    } catch (error) {
      toast.error("Ошибка верификации");
    } finally {
      setIsVerifying(false);
    }
  };

  const selectedExchangeConfig = getExchangeById(selectedExchangeId, selectedExchangeType);

  // Get unique exchanges
  const uniqueExchanges = SUPPORTED_EXCHANGES.reduce((acc, exchange) => {
    if (!acc.find((e) => e.id === exchange.id)) {
      acc.push(exchange);
    }
    return acc;
  }, [] as Exchange[]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Биржи</h2>
          <p className="text-muted-foreground">
            Подключите API ключи для автоматической торговли
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-sm">
            {accounts.filter((a) => a.isActive).length} активных
          </Badge>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchAccounts}
            disabled={isLoading}
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Exchange Cards by Type */}
      <Tabs defaultValue="futures" className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-6">
          <TabsTrigger value="spot">Spot</TabsTrigger>
          <TabsTrigger value="futures">Futures</TabsTrigger>
          <TabsTrigger value="inverse">Inverse</TabsTrigger>
        </TabsList>

        {(["spot", "futures", "inverse"] as ExchangeType[]).map((type) => (
          <TabsContent key={type} value={type} className="mt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {EXCHANGE_GROUPS[type].map((exchange) => {
                const account = getConnectedAccount(exchange.id, type);
                const isConnected = isExchangeConnected(exchange.id, type);
                const style = EXCHANGE_STYLES[exchange.id] || {
                  color: "#888",
                  bgColor: "#88888820",
                };

                return (
                  <Card
                    key={`${exchange.id}-${type}`}
                    className={cn(
                      "relative overflow-hidden transition-all",
                      isConnected && "border-green-500/50"
                    )}
                  >
                    {/* Status indicator */}
                    <div
                      className={cn(
                        "absolute top-0 left-0 right-0 h-1",
                        isConnected
                          ? "bg-green-500"
                          : account
                          ? "bg-yellow-500"
                          : "bg-gray-500"
                      )}
                    />

                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center"
                            style={{ backgroundColor: style.bgColor }}
                          >
                            <Building2
                              className="h-5 w-5"
                              style={{ color: style.color }}
                            />
                          </div>
                          <div>
                            <CardTitle className="text-base">
                              {exchange.displayName}
                            </CardTitle>
                            <CardDescription className="text-xs capitalize">
                              {type}
                            </CardDescription>
                          </div>
                        </div>

                        {/* Status badge */}
                        {isConnected ? (
                          <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
                            <Wifi className="h-3 w-3 mr-1" />
                            Connected
                          </Badge>
                        ) : account ? (
                          <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20">
                            <WifiOff className="h-3 w-3 mr-1" />
                            {account.lastError ? "Error" : "Inactive"}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Not connected
                          </Badge>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      {/* Fees */}
                      <div className="flex items-center gap-4 text-xs">
                        <div>
                          <span className="text-muted-foreground">Maker:</span>{" "}
                          <span className="font-medium">
                            {(exchange.fees.maker * 100).toFixed(2)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Taker:</span>{" "}
                          <span className="font-medium">
                            {(exchange.fees.taker * 100).toFixed(2)}%
                          </span>
                        </div>
                      </div>

                      {/* Features */}
                      <div className="flex flex-wrap gap-1">
                        {exchange.features.hedgeMode && (
                          <Badge variant="outline" className="text-xs">
                            Hedge Mode
                          </Badge>
                        )}
                        {exchange.features.trailingStop && (
                          <Badge variant="outline" className="text-xs">
                            Trailing Stop
                          </Badge>
                        )}
                        {exchange.features.testnet && (
                          <Badge variant="outline" className="text-xs">
                            Testnet
                          </Badge>
                        )}
                        {exchange.features.demo && (
                          <Badge variant="outline" className="text-xs">
                            Demo
                          </Badge>
                        )}
                      </div>

                      {/* Account info if connected */}
                      {account && (
                        <div className="p-2 rounded-lg bg-secondary/50 text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Type:</span>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-xs",
                                account.accountType === "DEMO"
                                  ? "demo-badge"
                                  : "real-badge"
                              )}
                            >
                              {account.accountType}
                            </Badge>
                          </div>
                          {account.lastSyncAt && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Last sync:</span>
                              <span>
                                {new Date(account.lastSyncAt).toLocaleTimeString("ru-RU")}
                              </span>
                            </div>
                          )}
                          {account.lastError && (
                            <div className="text-red-500 line-clamp-1">
                              {account.lastError}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        {account ? (
                          <>
                            <Switch
                              checked={account.isActive}
                              onCheckedChange={() => handleToggleActive(account)}
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => {
                                setSelectedAccount(account);
                                setShowSettingsDialog(true);
                              }}
                            >
                              <Settings className="h-3.5 w-3.5 mr-1" />
                              Settings
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => handleDisconnect(account)}
                            >
                              <Unlink className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            className="w-full"
                            size="sm"
                            onClick={() => handleAddExchange(exchange.id, type)}
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Connect
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Add Exchange Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Подключить биржу
            </DialogTitle>
            <DialogDescription>
              Введите API ключи для подключения биржи
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Exchange select */}
            <div className="space-y-2">
              <Label>Биржа</Label>
              <select
                className="w-full h-10 px-3 rounded-md border border-input bg-background"
                value={selectedExchangeId}
                onChange={(e) => setSelectedExchangeId(e.target.value)}
              >
                {uniqueExchanges.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.displayName}
                  </option>
                ))}
              </select>
            </div>

            {/* Type select */}
            <div className="space-y-2">
              <Label>Тип</Label>
              <select
                className="w-full h-10 px-3 rounded-md border border-input bg-background"
                value={selectedExchangeType}
                onChange={(e) =>
                  setSelectedExchangeType(e.target.value as ExchangeType)
                }
              >
                <option value="spot">Spot</option>
                <option value="futures">Futures</option>
                <option value="inverse">Inverse</option>
              </select>
            </div>

            {/* Testnet toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
              <div className="flex items-center gap-2">
                <TestTube className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Тестовый режим (Testnet)</span>
              </div>
              <Switch checked={formTestnet} onCheckedChange={setFormTestnet} />
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <Label>API ключ</Label>
              <Input
                type="password"
                placeholder="Введите API ключ"
                value={formApiKey}
                onChange={(e) => setFormApiKey(e.target.value)}
              />
            </div>

            {/* API Secret */}
            <div className="space-y-2">
              <Label>Секретный ключ</Label>
              <Input
                type="password"
                placeholder="Введите секретный ключ"
                value={formApiSecret}
                onChange={(e) => setFormApiSecret(e.target.value)}
              />
            </div>

            {/* Passphrase if required */}
            {selectedExchangeConfig?.requiresPassphrase && (
              <div className="space-y-2">
                <Label>API пароль (Passphrase)</Label>
                <Input
                  type="password"
                  placeholder="Введите пароль"
                  value={formPassphrase}
                  onChange={(e) => setFormPassphrase(e.target.value)}
                />
              </div>
            )}

            {/* Warning */}
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
                <div className="text-xs text-amber-600 dark:text-amber-400">
                  <p className="font-medium">Важно!</p>
                  <p className="mt-1">
                    Используйте API ключи только с правами на чтение и торговлю.
                    Запрещено использовать ключи с правом вывода средств.
                  </p>
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowAddDialog(false)}
              >
                Отмена
              </Button>
              <Button
                className="flex-1"
                onClick={handleSubmit}
                disabled={isSubmitting || !formApiKey || !formApiSecret}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4 mr-1" />
                )}
                Подключить
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Настройки {selectedAccount?.exchangeName}
            </DialogTitle>
            <DialogDescription>Управление подключением</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {selectedAccount && (
              <>
                {/* Status */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                  <div className="flex items-center gap-2">
                    {selectedAccount.lastError ? (
                      <XCircle className="h-5 w-5 text-red-500" />
                    ) : selectedAccount.isActive ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <Clock className="h-5 w-5 text-yellow-500" />
                    )}
                    <div>
                      <p className="text-sm font-medium">
                        {selectedAccount.lastError
                          ? "Ошибка"
                          : selectedAccount.isActive
                          ? "Активен"
                          : "Отключён"}
                      </p>
                      {selectedAccount.lastSyncAt && (
                        <p className="text-xs text-muted-foreground">
                          Синхронизация:{" "}
                          {new Date(selectedAccount.lastSyncAt).toLocaleString("ru-RU")}
                        </p>
                      )}
                    </div>
                  </div>
                  <Badge variant={selectedAccount.isTestnet ? "outline" : "default"}>
                    {selectedAccount.isTestnet ? "Testnet" : "Mainnet"}
                  </Badge>
                </div>

                {/* Error message */}
                {selectedAccount.lastError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <p className="text-xs text-red-500">{selectedAccount.lastError}</p>
                  </div>
                )}

                {/* API Key */}
                <div className="space-y-2">
                  <Label>API ключ</Label>
                  <Input value={selectedAccount.apiKey || "Не указан"} disabled />
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleVerify}
                    disabled={isVerifying}
                  >
                    {isVerifying ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4 mr-1" />
                    )}
                    Проверить
                  </Button>
                  <Button
                    variant={selectedAccount.isActive ? "destructive" : "default"}
                    className="flex-1"
                    onClick={() => {
                      handleToggleActive(selectedAccount);
                      setShowSettingsDialog(false);
                    }}
                  >
                    {selectedAccount.isActive ? "Отключить" : "Активировать"}
                  </Button>
                </div>

                {/* Disconnect */}
                <Button
                  variant="outline"
                  className="w-full text-destructive hover:text-destructive"
                  onClick={() => {
                    handleDisconnect(selectedAccount);
                    setShowSettingsDialog(false);
                  }}
                >
                  <Unlink className="h-4 w-4 mr-1" />
                  Отключить биржу
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
