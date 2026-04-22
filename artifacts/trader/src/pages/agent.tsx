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
  useGetSuggestedTickers,
  getGetAgentStatusQueryKey,
  getGetWatchlistQueryKey,
  getGetSuggestedTickersQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bot, Play, Square, Trash2, TerminalSquare, Search, Plus, Check, ShieldAlert, Wallet, AlertTriangle, CheckCircle2, XCircle, MinusCircle, Sparkles, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

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
  const { data: suggested, isLoading: isLoadingSuggest, refetch: refetchSuggest, isFetching: isFetchingSuggest } = useGetSuggestedTickers();

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
        queryClient.invalidateQueries({ queryKey: getGetSuggestedTickersQueryKey() });
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
      setStreamData(prev => prev + "\n[ОШИБКА] Поток прерван.");
    } finally {
      setIsStreaming(false);
      queryClient.invalidateQueries({ queryKey: getGetAgentStatusQueryKey() });
    }
  };

  const isInWatchlist = (figi: string) => watchlist?.some(w => w.figi === figi);

  // Сводка по доступности денег
  const cashRub = stats?.cashRub ?? 0;
  const affordable = (stats?.affordability ?? []).filter(a => a.canAffordLots > 0);
  const tooExpensive = (stats?.affordability ?? []).filter(a => a.canAffordLots === 0 && a.lotPriceRub > 0);

  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight truncate">ИИ-агент</h1>
          <p className="text-muted-foreground text-sm mt-0.5 hidden sm:block">Что делает ИИ с вашими деньгами</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status && (
            <Badge variant="outline" className={`px-2 py-1 text-xs ${status.isRunning ? "border-green-500 text-green-500" : "border-muted-foreground text-muted-foreground"}`}>
              {status.isRunning ? "Работает" : "Остановлен"}
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

      {/* МОНЕТКИ — что с деньгами */}
      {stats && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="w-4 h-4" /> Деньги и что ИИ может купить
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="flex items-baseline gap-3 flex-wrap">
              <div className="text-3xl font-bold font-mono">₽{cashRub.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="text-sm text-muted-foreground">— свободно на счёте, ИИ это видит</div>
            </div>

            {stats.affordability.length === 0 ? (
              <p className="text-sm text-muted-foreground">Добавьте акции в список наблюдения, чтобы увидеть, что ИИ может купить.</p>
            ) : (
              <div className="space-y-1.5">
                {affordable.length > 0 && (
                  <div className="rounded-md border border-green-700/40 bg-green-950/20 p-3">
                    <p className="text-xs font-medium text-green-400 mb-2 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> На эти деньги хватит:
                    </p>
                    <div className="space-y-1">
                      {affordable.map(a => (
                        <div key={a.figi} className="flex items-center justify-between text-sm">
                          <span className="font-mono font-bold">{a.ticker}</span>
                          <span className="text-muted-foreground text-xs">
                            {a.canAffordLots} лот ({a.canAffordLots * a.lot} шт.) · 1 лот = ₽{a.lotPriceRub.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {tooExpensive.length > 0 && (
                  <div className="rounded-md border border-yellow-700/40 bg-yellow-950/20 p-3">
                    <p className="text-xs font-medium text-yellow-400 mb-2 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Не хватает даже на 1 лот:
                    </p>
                    <div className="space-y-1">
                      {tooExpensive.map(a => (
                        <div key={a.figi} className="flex items-center justify-between text-sm">
                          <span className="font-mono font-bold">{a.ticker}</span>
                          <span className="text-muted-foreground text-xs">
                            нужно ₽{a.lotPriceRub.toFixed(2)} за 1 лот ({a.lot} шт. × ₽{a.lastPrice.toFixed(2)})
                          </span>
                        </div>
                      ))}
                    </div>
                    {cashRub < 1000 && (
                      <p className="text-xs text-yellow-300/80 mt-2">
                        💡 Чтобы ИИ начал покупать, пополните счёт хотя бы на сумму одного лота. Самый дешёвый из ваших — {tooExpensive.sort((a, b) => a.lotPriceRub - b.lotPriceRub)[0]?.ticker} за ₽{tooExpensive.sort((a, b) => a.lotPriceRub - b.lotPriceRub)[0]?.lotPriceRub.toFixed(0)}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ПОДСКАЗКИ ИИ ПО ТИКЕРАМ */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Что добавить в анализ
            </CardTitle>
            <CardDescription className="text-xs">
              Популярные акции МосБиржи с подсказкой ИИ — нажмите «+», чтобы добавить
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2 shrink-0" onClick={() => refetchSuggest()} disabled={isFetchingSuggest}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isFetchingSuggest ? "animate-spin" : ""}`} /> Обновить
          </Button>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          {isLoadingSuggest ? (
            <Skeleton className="h-32 w-full" />
          ) : !suggested ? (
            <p className="text-sm text-muted-foreground">Не удалось получить список. Проверьте, что токен Tinkoff подключён.</p>
          ) : (
            <>
              {/* AI picks */}
              {suggested.aiPicks.length > 0 && (
                <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
                  <p className="text-xs font-medium text-primary flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" /> ИИ рекомендует начать с этих:
                  </p>
                  {suggested.aiPicks.map(p => {
                    const t = suggested.tickers.find(x => x.ticker === p.ticker);
                    return (
                      <div key={p.ticker} className="flex items-start gap-2 text-sm">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs shrink-0"
                          disabled={!t || t.inWatchlist || addToWatchlist.isPending}
                          onClick={() => t && addToWatchlist.mutate({ data: { figi: t.figi, ticker: t.ticker, name: t.name } })}
                        >
                          {t?.inWatchlist ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        </Button>
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="font-mono font-bold text-sm">{p.ticker}</span>
                            {t && (
                              <span className="text-[11px] text-muted-foreground">
                                ₽{t.lotPriceRub.toFixed(0)}/лот · {t.canAfford ? <span className="text-green-500">хватает</span> : <span className="text-yellow-400">не хватает</span>}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground/90 mt-0.5">{p.reason}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* All popular tickers */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Все популярные ({suggested.tickers.length}):</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {suggested.tickers.map(t => (
                    <div
                      key={t.figi}
                      className={`flex items-center justify-between gap-2 rounded-md border p-2 ${
                        t.inWatchlist ? "border-border/30 bg-muted/10 opacity-60" :
                        t.canAfford ? "border-green-700/30 bg-green-950/10" :
                        "border-border bg-muted/5"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono font-bold text-sm">{t.ticker}</span>
                          <span className="text-[10px] text-muted-foreground uppercase">{t.sector}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          1 лот ({t.lot} шт.) = ₽{t.lotPriceRub.toFixed(0)}
                          {!t.canAfford && t.lotPriceRub > 0 && <span className="text-yellow-400/80 ml-1">не хватает</span>}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        disabled={t.inWatchlist || addToWatchlist.isPending}
                        onClick={() => addToWatchlist.mutate({ data: { figi: t.figi, ticker: t.ticker, name: t.name } })}
                      >
                        {t.inWatchlist ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Plus className="w-3.5 h-3.5 text-primary" />}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ЧТО СДЕЛАЛ ИИ — простая сводка */}
      {stats && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-base">Что сделал ИИ</CardTitle>
            <CardDescription className="text-xs">
              Режим: <span className={stats.mode === "paper" ? "text-blue-400 font-bold" : "text-yellow-400 font-bold"}>{stats.mode === "paper" ? "PAPER (тренировка, без реальных денег)" : "LIVE (реальные сделки)"}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            {/* Действия в простом виде */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-green-700/40 bg-green-950/20 p-3 text-center">
                <div className="text-2xl font-bold font-mono text-green-400">{stats.buyCount}</div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-0.5">Покупок</div>
              </div>
              <div className="rounded-lg border border-red-700/40 bg-red-950/20 p-3 text-center">
                <div className="text-2xl font-bold font-mono text-red-400">{stats.sellCount}</div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-0.5">Продаж</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
                <div className="text-2xl font-bold font-mono text-muted-foreground">{stats.holdCount}</div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-0.5">Без действий</div>
              </div>
            </div>

            {/* Открытые / закрытые */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
                <div className="text-xs text-muted-foreground">Сейчас в позициях</div>
                <div className="text-xl font-bold font-mono">{stats.openPositions}</div>
                <div className={`text-xs font-mono mt-1 ${stats.unrealizedPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {stats.unrealizedPnl >= 0 ? "+" : ""}{stats.unrealizedPnl.toFixed(2)} ₽ (бумажный P&L)
                </div>
              </div>
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
                <div className="text-xs text-muted-foreground">Закрытые сделки</div>
                <div className="text-xl font-bold font-mono">{stats.closedPositions}</div>
                <div className={`text-xs font-mono mt-1 ${stats.realizedPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {stats.realizedPnl >= 0 ? "+" : ""}{stats.realizedPnl.toFixed(2)} ₽ (зафиксировано)
                </div>
              </div>
            </div>

            {/* Доля прибыльных */}
            {stats.closedPositions > 0 ? (
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm">Доля прибыльных сделок</span>
                  <span className={`text-lg font-bold font-mono ${stats.winRate >= 55 ? "text-green-500" : "text-red-500"}`}>
                    {stats.winRate.toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div className={`h-full ${stats.winRate >= 55 ? "bg-green-500" : "bg-red-500"}`} style={{ width: `${stats.winRate}%` }} />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Из {stats.closedPositions} закрытых — {Math.round(stats.closedPositions * stats.winRate / 100)} в плюс. Хорошо: 55%+.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3 text-center text-sm text-muted-foreground">
                Закрытых сделок пока нет — статистики прибыльности нет.
              </div>
            )}

            <div className="text-[11px] text-muted-foreground border-t border-border/50 pt-2">
              Всего проанализировано бумаг: <span className="font-mono">{stats.totalDecisions}</span> ·
              сегодня сделок: <span className="font-mono">{stats.dailyTradesUsed}</span> ·
              средняя уверенность ИИ: <span className="font-mono">{stats.avgConfidence.toFixed(0)}%</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* НЕДАВНИЕ РЕШЕНИЯ */}
      {stats && stats.recentDecisions.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-base">Последние 15 решений</CardTitle>
            <CardDescription className="text-xs">
              Что и почему ИИ решил по каждой бумаге
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <div className="divide-y divide-border/50">
              {stats.recentDecisions.map(d => {
                const Icon = d.action === "buy" ? CheckCircle2 : d.action === "sell" ? XCircle : MinusCircle;
                const color = d.action === "buy" ? "text-green-500" : d.action === "sell" ? "text-red-500" : "text-muted-foreground";
                const label = d.action === "buy" ? "ПОКУПКА" : d.action === "sell" ? "ПРОДАЖА" : "ДЕРЖАТЬ";
                return (
                  <div key={d.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 ${color}`} />
                        <span className="font-mono font-bold text-sm">{d.ticker}</span>
                        <span className={`text-xs font-medium ${color}`}>{label}</span>
                        <span className="text-xs text-muted-foreground">{d.confidence}%</span>
                        {d.executed && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-600/50 text-green-400">
                            исполнено
                          </Badge>
                        )}
                        {!d.executed && d.skipReason && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-yellow-600/50 text-yellow-400">
                            пропуск
                          </Badge>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                        {format(new Date(d.createdAt), "d MMM HH:mm", { locale: ru })}
                      </span>
                    </div>
                    {d.executed && d.quantity != null && d.price != null && (
                      <p className="text-xs text-muted-foreground ml-6">
                        {d.quantity} шт. × ₽{d.price.toFixed(2)} = ₽{(d.quantity * d.price).toFixed(2)}
                        {d.realizedPnl != null && (
                          <span className={`ml-2 font-mono ${d.realizedPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                            ({d.realizedPnl >= 0 ? "+" : ""}{d.realizedPnl.toFixed(2)} ₽)
                          </span>
                        )}
                      </p>
                    )}
                    {d.skipReason && (
                      <p className="text-xs text-yellow-300/80 ml-6 mt-0.5">
                        Не сделал, потому что: {d.skipReason}
                      </p>
                    )}
                    {d.reasoning && (
                      <p className="text-xs text-muted-foreground/80 ml-6 mt-1 line-clamp-2">{d.reasoning}</p>
                    )}
                  </div>
                );
              })}
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
              <CardTitle className="text-xs font-mono tracking-widest uppercase">Поток мыслей ИИ</CardTitle>
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
