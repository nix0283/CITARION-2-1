"use client";

import { useCryptoStore, TradingMode } from "@/stores/crypto-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Moon, Sun, User, LogOut, RefreshCw, Bell, Wallet, ChevronDown, AlertTriangle, TestTube, FlaskConical, Zap } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { useState, useEffect } from "react";

// Extended trading mode type for UI
type ExtendedTradingMode = "PAPER" | "TESTNET" | "DEMO" | "LIVE";

// Mode configuration
const MODE_CONFIG: Record<ExtendedTradingMode, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: typeof TestTube;
  description: string;
  requiresApiKey: boolean;
}> = {
  PAPER: {
    label: "PAPER",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
    icon: FlaskConical,
    description: "Симуляция с реальными ценами",
    requiresApiKey: false,
  },
  TESTNET: {
    label: "TESTNET",
    color: "text-yellow-500",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/20",
    icon: TestTube,
    description: "Тестовая сеть биржи",
    requiresApiKey: true,
  },
  DEMO: {
    label: "DEMO",
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/20",
    icon: Zap,
    description: "Демо режим на live бирже",
    requiresApiKey: true,
  },
  LIVE: {
    label: "LIVE",
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
    icon: AlertTriangle,
    description: "⚠️ Реальная торговля",
    requiresApiKey: true,
  },
};

export function Header() {
  const { account, setTradingMode, resetDemoBalance, setActiveTab } = useCryptoStore();
  const { theme, setTheme } = useTheme();
  
  // Get current mode from account type or default to PAPER
  const getCurrentMode = (): ExtendedTradingMode => {
    const accountType = account?.accountType;
    const isTestnet = account?.isTestnet;
    
    if (accountType === "REAL" && !isTestnet) return "LIVE";
    if (accountType === "DEMO" && isTestnet) return "TESTNET";
    if (accountType === "DEMO") return "DEMO";
    return "PAPER";
  };
  
  const currentMode = getCurrentMode();
  const modeConfig = MODE_CONFIG[currentMode];
  const ModeIcon = modeConfig.icon;
  
  const balance = account?.virtualBalance?.USDT || 0;
  
  // Notification count state
  const [notificationCount] = useState(3);

  const handleModeChange = (mode: ExtendedTradingMode) => {
    // Map to store's TradingMode type
    const storeMode: TradingMode = mode === "LIVE" ? "REAL" : "DEMO";
    setTradingMode(storeMode);
    
    // Update account type based on mode
    console.log(`[Header] Switching to ${mode} mode`);
  };

  const handleResetBalance = async () => {
    try {
      const response = await fetch("/api/account/reset-balance", {
        method: "POST",
      });
      if (response.ok) {
        resetDemoBalance();
      }
    } catch (error) {
      console.error("Failed to reset balance:", error);
    }
  };

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <header className="sticky top-0 z-30 h-14 md:h-16 border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="flex h-full items-center justify-between px-3 md:px-6">
        {/* Left side - Page Title + Mode Badge */}
        <div className="flex items-center gap-2 md:gap-4">
          {/* Mobile spacing for menu button */}
          <div className="w-11 md:hidden" aria-hidden="true" />
          
          <h2 className="text-sm md:text-lg font-semibold text-foreground truncate">
            Панель управления
          </h2>
          
          {/* Mode Badge - Compact on mobile */}
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] md:text-xs font-medium",
              modeConfig.bgColor,
              modeConfig.color,
              modeConfig.borderColor
            )}
          >
            <ModeIcon className="h-3 w-3 mr-1" />
            [{modeConfig.label}]
          </Badge>
        </div>

        {/* Right side - Actions */}
        <div className="flex items-center gap-2 md:gap-4">
          {/* Mobile Balance Display */}
          <div className="flex md:hidden items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50">
            <Wallet className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold">
              ${formatNumber(balance, 0)}
            </span>
          </div>

          {/* Reset Balance (Non-LIVE modes) - Hidden on mobile */}
          {currentMode !== "LIVE" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetBalance}
              className="hidden md:flex h-8"
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Сбросить
            </Button>
          )}

          {/* Trading Mode Selector - Desktop */}
          <div className="hidden sm:flex items-center gap-2 rounded-lg border border-border px-2 py-1">
            <Label className="text-xs text-muted-foreground">Mode:</Label>
            <Select value={currentMode} onValueChange={handleModeChange}>
              <SelectTrigger className="h-7 w-[130px] border-0 bg-transparent text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MODE_CONFIG).map(([mode, config]) => {
                  const Icon = config.icon;
                  return (
                    <SelectItem key={mode} value={mode}>
                      <div className="flex items-center gap-2">
                        <Icon className={cn("h-3.5 w-3.5", config.color)} />
                        <span className={config.color}>{config.label}</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Notification Bell - Desktop */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:flex h-8 w-8 relative"
            aria-label="Notifications"
            onClick={() => setActiveTab("notifications")}
          >
            <Bell className="h-4 w-4" />
            {/* Notification badge */}
            {notificationCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-medium text-white flex items-center justify-center">
                {notificationCount}
              </span>
            )}
          </Button>

          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-8 w-8"
            suppressHydrationWarning
            aria-label="Toggle theme"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>

          {/* User Menu - Desktop */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="hidden md:flex relative h-8 w-8 rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarImage src="/avatar.png" alt="User" />
                  <AvatarFallback className="bg-primary/20 text-primary text-xs">
                    TR
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">Trader</p>
                  <p className="text-xs text-muted-foreground">
                    Balance: ${formatNumber(balance, 2)}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                <span>Профиль</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Выйти</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mobile Quick Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="md:hidden h-8 px-2"
                aria-label="Quick menu"
              >
                <Avatar className="h-6 w-6">
                  <AvatarImage src="/avatar.png" alt="User" />
                  <AvatarFallback className="bg-primary/20 text-primary text-[10px]">
                    TR
                  </AvatarFallback>
                </Avatar>
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">Trader</p>
                  <p className="text-xs text-muted-foreground">
                    Balance: ${formatNumber(balance, 2)} USDT
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              
              {/* Mode Selector for Mobile */}
              <div className="px-2 py-1.5">
                <Label className="text-xs text-muted-foreground">Trading Mode</Label>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  {Object.entries(MODE_CONFIG).map(([mode, config]) => {
                    const Icon = config.icon;
                    const isActive = currentMode === mode;
                    return (
                      <Button
                        key={mode}
                        variant={isActive ? "default" : "ghost"}
                        size="sm"
                        className={cn(
                          "h-7 text-[10px] justify-start",
                          isActive && config.bgColor,
                          isActive && config.color
                        )}
                        onClick={() => handleModeChange(mode as ExtendedTradingMode)}
                      >
                        <Icon className="h-3 w-3 mr-1" />
                        {config.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
              
              {currentMode !== "LIVE" && (
                <DropdownMenuItem onClick={handleResetBalance}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  <span>Reset Balance</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setActiveTab("notifications")}>
                <Bell className="mr-2 h-4 w-4" />
                <span>Notifications</span>
                {notificationCount > 0 && (
                  <Badge variant="destructive" className="ml-auto text-[10px] h-4 px-1">
                    {notificationCount}
                  </Badge>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
