import { useState, useRef } from "react";
import { 
  useGetAgentStatus, 
  useStartAgent, 
  useStopAgent, 
  useGetWatchlist, 
  useRemoveFromWatchlist,
  useAddToWatchlist,
  useSearchInstruments,
  useGetAgentStats,
  getGetAgentStatusQueryKey,
  getGetWatchlistQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bot, Play, Square, Trash2, TerminalSquare, Search, Plus, Check, ShieldAlert } from "lucide-react";

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "bad" | "neutral" }) {
  const color = tone === "good" ? "text-green-500" : tone === "bad" ? "text-red-500" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
    </div>
  );
}

export default function AgentPage() {
  const queryClient = useQueryClient();
  const [streamData, setStreamData] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [allowTrading, setAllowTrading] = useState(false);
  
  const { data: status, isLoading: isStatusLoading } = useGetAgentStatus();
  const { data: watchlist, isLoading: isWatchlistLoading } = useGetWatchlist();
  const { data: stats } = useGetAgentStats({ query: { refetchInterval: 30000 } });

  const startAgent = useStartAgent({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetAgentStatusQueryKey() }) }
  });
  const stopAgent = useStopAgent({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetAgentStatusQueryKey() }) }
  });
  const removeWatchlist = useRemoveFromWatchlist({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() }) }
  });
  const addToWatchlist = useAddToWatchlist({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        setSearchQuery("");
        setDebouncedQuery("");
      }
    }
  });

  const { data: searchResults, isLoading: isSearching } = useSearchInstruments(
    { query: debouncedQuery },
    { query: { enabled: debouncedQuery.length > 1 } }
  );

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedQuery(val), 400);
  };

  const handleManualAnalyze = async (figi?: string) => {
    setIsStreaming(true);
    setStreamData("");
    try {
      const response = await fetch("/api/agent/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ figi: figi || null, executeIfConfident: allowTrading })
      });
      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        setStreamData(prev => prev + text);
        if (streamRef.current) {
          streamRef.current.scrollTop = streamRef.current.scrollHeight;
        }
      }
    } catch {
      setStreamData(prev => prev + "\n[ERROR] Stream interrupted.");
    } finally {
      setIsStreaming(false);
      queryClient.invalidateQueries({ queryKey: getGetAgentStatusQueryKey() });
    }
  };

  const isInWatchlist = (figi: string) => watchlist?.some(w => w.figi === figi);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight truncate">AI Agent</h1>
          <p className="text-muted-foreground text-sm mt-0.5 hidden sm:block">Автономная торговля и список наблюдения</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status && (
            <Badge variant="outline" className={`px-2 py-1 text-xs ${status.isRunning ? "border-green-500 text-green-500" : "border-muted-foreground text-muted-foreground"}`}>
              {status.isRunning ? "Активен" : "Пауза"}
            </Badge>
          )}
          {status?.isRunning ? (
            <Button variant="destructive" size="sm" onClick={() => stopAgent.mutate({})} disabled={stopAgent.isPending}>
              <Square className="w-4 h-4 mr-1 fill-current" /> Стоп
            </Button>
          ) : (
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => startAgent.mutate({})} disabled={startAgent.isPending || isStatusLoading}>
              <Play className="w-4 h-4 mr-1 fill-current" /> Старт
            </Button>
          )}
        </div>
      </div>

      {/* Stats dashboard */}
      {stats && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3 pt-4 px-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Статистика агента</CardTitle>
              <CardDescription className="text-xs">
                Режим: <span className={stats.mode === "paper" ? "text-blue-400 font-bold" : "text-yellow-400 font-bold"}>{stats.mode === "paper" ? "PAPER (симуляция)" : "LIVE (боевой)"}</span>
                {" · "}Готовность к live: P&L &gt; 0, win-rate &gt; 55%, обыгрывает buy-and-hold за 2 недели
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Stat label="Решений" value={stats.totalDecisions} />
              <Stat label="Сделок (откр./закр.)" value={`${stats.openPositions} / ${stats.closedPositions}`} />
              <Stat label="Win-rate" value={`${stats.winRate.toFixed(1)}%`} tone={stats.winRate >= 55 ? "good" : stats.closedPositions === 0 ? "neutral" : "bad"} />
              <Stat label="Realized P&L" value={`${stats.realizedPnl >= 0 ? "+" : ""}${stats.realizedPnl.toFixed(2)}₽`} tone={stats.realizedPnl >= 0 ? "good" : "bad"} />
              <Stat label="Unrealized P&L" value={`${stats.unrealizedPnl >= 0 ? "+" : ""}${stats.unrealizedPnl.toFixed(2)}₽`} tone={stats.unrealizedPnl >= 0 ? "good" : "bad"} />
              <Stat label="Avg confidence" value={`${stats.avgConfidence.toFixed(0)}%`} />
              <Stat label="Vs buy-and-hold" value={`${stats.vsBuyAndHold.agentReturnPct.toFixed(1)}% / ${stats.vsBuyAndHold.buyHoldReturnPct.toFixed(1)}%`} tone={stats.vsBuyAndHold.agentReturnPct >= stats.vsBuyAndHold.buyHoldReturnPct ? "good" : "bad"} />
              <Stat label="Сегодня: сделок / убыток" value={`${stats.dailyTradesUsed} / ${stats.dailyLossUsedRub.toFixed(0)}₽`} />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Калибровка уверенности (по закрытым сделкам):</p>
              <div className="grid grid-cols-5 gap-1">
                {stats.calibration.map(b => (
                  <div key={b.bucket} className="text-center p-2 rounded border border-border/50 bg-muted/10">
                    <div className="text-[10px] text-muted-foreground">{b.bucket}</div>
                    <div className="text-sm font-bold font-mono">{b.decisions > 0 ? `${b.winRate.toFixed(0)}%` : "—"}</div>
                    <div className="text-[10px] text-muted-foreground">{b.decisions} сд.</div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        
        {/* Watchlist */}
        <Card className="bg-card border-border flex flex-col lg:col-span-1">
          <CardHeader className="border-b border-border pb-3 pt-4 px-4">
            <CardTitle className="text-base">Список наблюдения</CardTitle>
            <CardDescription className="text-xs">Акции, которые анализирует ИИ</CardDescription>
          </CardHeader>

          {/* Search to add */}
          <div className="px-3 pt-3 pb-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Найти акцию... (SBER, GAZP...)"
                className="pl-8 h-8 text-sm bg-background border-border"
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
              />
            </div>
            {/* Search results dropdown */}
            {debouncedQuery.length > 1 && (
              <div className="mt-1 rounded-md border border-border bg-background shadow-lg max-h-48 overflow-y-auto">
                {isSearching ? (
                  <div className="p-2 space-y-1">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : !searchResults?.length ? (
                  <div className="p-3 text-center text-xs text-muted-foreground">Ничего не найдено</div>
                ) : (
                  searchResults.slice(0, 8).map(inst => {
                    const inList = isInWatchlist(inst.figi);
                    return (
                      <button
                        key={inst.figi}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-center justify-between gap-2 transition-colors"
                        onClick={() => {
                          if (!inList) {
                            addToWatchlist.mutate({ data: { figi: inst.figi, ticker: inst.ticker, name: inst.name } });
                          }
                        }}
                        disabled={inList || addToWatchlist.isPending}
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-xs font-mono">{inst.ticker}</span>
                          <span className="text-xs text-muted-foreground ml-2 truncate">{inst.name}</span>
                        </div>
                        {inList ? (
                          <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        ) : (
                          <Plus className="w-3.5 h-3.5 text-primary shrink-0" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <CardContent className="p-0 flex-1 overflow-y-auto">
            {isWatchlistLoading ? (
              <div className="p-4 space-y-3">
                <Skeleton className="h-12 w-full"/>
                <Skeleton className="h-12 w-full"/>
              </div>
            ) : watchlist?.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                <Bot className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Список пуст. Найдите акции выше.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {watchlist?.map((item) => (
                  <div key={item.id} className="px-4 py-3 flex items-center justify-between hover:bg-muted/20 gap-2">
                    <div className="min-w-0">
                      <p className="font-bold font-mono text-sm">{item.ticker}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.name}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => handleManualAnalyze(item.figi)} disabled={isStreaming}>
                        Анализ
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => removeWatchlist.mutate({ id: item.id })}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          <div className="p-3 border-t border-border bg-muted/10">
            <Button variant="default" className="w-full h-9 text-sm" onClick={() => handleManualAnalyze()} disabled={isStreaming || !watchlist?.length}>
              <Bot className="w-4 h-4 mr-2" /> Анализировать всё
            </Button>
          </div>
        </Card>

        {/* Live Analysis Stream */}
        <Card className="bg-[#0a0a0a] border-border flex flex-col lg:col-span-2 min-h-[320px]">
          <CardHeader className="border-b border-border/50 pb-3 pt-4 px-4 flex flex-row items-center justify-between gap-3">
            <div className="flex items-center text-primary shrink-0">
              <TerminalSquare className="w-4 h-4 mr-2" />
              <CardTitle className="text-xs font-mono tracking-widest uppercase">Live Thought Stream</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {isStreaming && <div className="h-2 w-2 rounded-full bg-primary animate-pulse shrink-0" />}
            </div>
          </CardHeader>

          {/* Trading toggle */}
          <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-3 transition-colors ${allowTrading ? "border-yellow-600/50 bg-yellow-950/30" : "border-border/30 bg-muted/5"}`}>
            <div className="flex items-center gap-2 min-w-0">
              <ShieldAlert className={`w-4 h-4 shrink-0 ${allowTrading ? "text-yellow-400" : "text-muted-foreground"}`} />
              <div className="min-w-0">
                <Label htmlFor="allow-trading" className={`text-xs font-medium cursor-pointer ${allowTrading ? "text-yellow-400" : "text-muted-foreground"}`}>
                  {allowTrading ? "Торговля включена — ИИ может покупать/продавать" : "Только анализ (без сделок)"}
                </Label>
              </div>
            </div>
            <Switch
              id="allow-trading"
              checked={allowTrading}
              onCheckedChange={setAllowTrading}
              className={allowTrading ? "data-[state=checked]:bg-yellow-500" : ""}
            />
          </div>

          <CardContent className="p-0 flex-1 relative min-h-[260px]">
            <div 
              ref={streamRef}
              className="absolute inset-0 overflow-y-auto p-4 font-mono text-sm text-[#00ff9d] whitespace-pre-wrap leading-relaxed"
              style={{ textShadow: "0 0 5px rgba(0,255,157,0.3)" }}
            >
              {streamData ? streamData : (
                <div className="text-muted-foreground/50 italic h-full flex items-center justify-center text-center text-xs px-4">
                  Нажмите «Анализ» у акции или «Анализировать всё» чтобы запустить ИИ
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
