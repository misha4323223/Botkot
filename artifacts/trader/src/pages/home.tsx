import { useGetPortfolioSummary, useGetAgentStatus, useListTradeLogs, useGetPortfolio } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, TrendingUp, TrendingDown, DollarSign, Wallet, Activity, ActivityIcon } from "lucide-react";
import { format } from "date-fns";

export default function Home() {
  const { data: summary, isLoading: isLoadingSummary } = useGetPortfolioSummary();
  const { data: agentStatus, isLoading: isLoadingAgent } = useGetAgentStatus();
  const { data: tradeLogs, isLoading: isLoadingLogs } = useListTradeLogs({ limit: 5 });
  const { data: portfolio, isLoading: isLoadingPortfolio } = useGetPortfolio();

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Главная</h1>
        {agentStatus && (
          <Badge variant={agentStatus.isRunning ? "default" : "secondary"} className={agentStatus.isRunning ? "bg-success text-success-foreground" : ""}>
            {agentStatus.isRunning ? (
              <><ActivityIcon className="w-3 h-3 mr-1 animate-pulse" /> Агент активен</>
            ) : "Агент на паузе"}
          </Badge>
        )}
      </div>

      {/* Money distribution */}
      <Card className="bg-card border-card-border p-6">
        <h2 className="text-sm font-medium text-muted-foreground mb-4">Где сейчас деньги</h2>
        {isLoadingSummary || isLoadingPortfolio ? (
          <Skeleton className="h-16 w-full" />
        ) : (() => {
          const cash = summary?.cashRub ?? 0;
          const invested = (portfolio?.positions ?? []).reduce((s, p) => s + p.currentValue, 0);
          const total = cash + invested;
          const cashPct = total > 0 ? (cash / total) * 100 : 0;
          const invPct = total > 0 ? (invested / total) * 100 : 0;
          return (
            <div className="space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Свободные деньги</div>
                  <div className="text-2xl font-bold font-mono">₽{cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="text-xs text-muted-foreground">{cashPct.toFixed(1)}%</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">В акциях</div>
                  <div className="text-2xl font-bold font-mono">₽{invested.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="text-xs text-muted-foreground">{invPct.toFixed(1)}%</div>
                </div>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                <div className="bg-primary" style={{ width: `${cashPct}%` }} />
                <div className="bg-success" style={{ width: `${invPct}%` }} />
              </div>
              {(portfolio?.positions ?? []).length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-2">
                  {portfolio!.positions.map((p) => (
                    <div key={p.figi} className="flex items-center justify-between bg-muted/40 rounded px-3 py-2">
                      <div>
                        <div className="text-sm font-semibold">{p.ticker}</div>
                        <div className="text-xs text-muted-foreground">{p.quantity} шт.</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-mono">₽{p.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className={`text-xs font-mono ${p.unrealizedPnl >= 0 ? "text-success" : "text-destructive"}`}>
                          {p.unrealizedPnl >= 0 ? "+" : ""}{p.unrealizedPnlPercent.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </Card>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-card-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Стоимость портфеля</CardTitle>
            <DollarSign className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-24" /> : (
              <>
                <div className="text-2xl font-bold text-card-foreground">
                  ₽{summary?.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Свободно: ₽{summary?.cashRub.toLocaleString()}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Общий P&L</CardTitle>
            <Wallet className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-24" /> : (
              <>
                <div className={`text-2xl font-bold ${summary && summary.totalPnl >= 0 ? "text-success" : "text-destructive"}`}>
                  {summary && summary.totalPnl >= 0 ? "+" : ""}
                  ₽{summary?.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className={`text-xs mt-1 ${summary && summary.totalPnlPercent >= 0 ? "text-success" : "text-destructive"}`}>
                  {summary && summary.totalPnlPercent >= 0 ? <TrendingUp className="w-3 h-3 inline mr-1" /> : <TrendingDown className="w-3 h-3 inline mr-1" />}
                  {summary?.totalPnlPercent.toFixed(2)}% за всё время
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">P&L за день</CardTitle>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-24" /> : (
              <>
                <div className={`text-2xl font-bold ${summary && summary.dailyPnl >= 0 ? "text-success" : "text-destructive"}`}>
                  {summary && summary.dailyPnl >= 0 ? "+" : ""}
                  ₽{summary?.dailyPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className={`text-xs mt-1 ${summary && summary.dailyPnlPercent >= 0 ? "text-success" : "text-destructive"}`}>
                  {summary && summary.dailyPnlPercent >= 0 ? <TrendingUp className="w-3 h-3 inline mr-1" /> : <TrendingDown className="w-3 h-3 inline mr-1" />}
                  {summary?.dailyPnlPercent.toFixed(2)}% сегодня
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Статус агента</CardTitle>
            <Bot className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingAgent ? <Skeleton className="h-8 w-24" /> : (
              <>
                <div className="text-2xl font-bold text-card-foreground">
                  {agentStatus?.totalTradesExecuted || 0} сделок
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Последний запуск: {agentStatus?.lastRunAt ? format(new Date(agentStatus.lastRunAt), "HH:mm") : "никогда"}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Positions */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Топ позиций</h2>
          <Card className="bg-card border-card-border">
            <div className="p-0">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground bg-muted/50 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 font-medium">Бумага</th>
                    <th className="px-4 py-3 font-medium text-right">Кол-во</th>
                    <th className="px-4 py-3 font-medium text-right">Цена</th>
                    <th className="px-4 py-3 font-medium text-right">Стоимость</th>
                    <th className="px-4 py-3 font-medium text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoadingPortfolio ? (
                    <tr><td colSpan={5} className="px-4 py-4 text-center"><Skeleton className="h-4 w-full" /></td></tr>
                  ) : portfolio?.positions.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Открытых позиций нет</td></tr>
                  ) : (
                    portfolio?.positions.slice(0, 5).map((pos) => (
                      <tr key={pos.figi} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-card-foreground">{pos.ticker}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[150px]">{pos.name}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-card-foreground">{pos.quantity}</td>
                        <td className="px-4 py-3 text-right font-mono text-card-foreground">₽{pos.currentPrice.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono text-card-foreground">₽{pos.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className={`px-4 py-3 text-right font-mono ${pos.unrealizedPnl >= 0 ? "text-success" : "text-destructive"}`}>
                          {pos.unrealizedPnl >= 0 ? "+" : ""}
                          ₽{pos.unrealizedPnl.toFixed(2)}
                          <div className="text-xs">
                            {pos.unrealizedPnl >= 0 ? "+" : ""}{pos.unrealizedPnlPercent.toFixed(2)}%
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Recent Activity */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Недавние сделки</h2>
          <Card className="bg-card border-card-border">
            <div className="p-4 space-y-4">
              {isLoadingLogs ? (
                <Skeleton className="h-20 w-full" />
              ) : tradeLogs?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">Сделок пока нет</div>
              ) : (
                tradeLogs?.map((log) => (
                  <div key={log.id} className="flex flex-col space-y-1 pb-4 border-b border-border last:border-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Badge variant="outline" className={
                          log.action === "buy" ? "border-success text-success" : 
                          log.action === "sell" ? "border-destructive text-destructive" : 
                          "border-primary text-primary"
                        }>
                          {log.action === "buy" ? "ПОКУПКА" : log.action === "sell" ? "ПРОДАЖА" : log.action === "hold" ? "ДЕРЖАТЬ" : log.action.toUpperCase()}
                        </Badge>
                        <span className="font-semibold font-mono text-card-foreground">{log.ticker}</span>
                      </div>
                      <span className="text-xs text-muted-foreground font-mono">
                        {format(new Date(log.createdAt), "HH:mm")}
                      </span>
                    </div>
                    {log.quantity && log.price && (
                      <div className="text-sm text-muted-foreground">
                        {log.quantity} @ ₽{log.price.toFixed(2)}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground truncate" title={log.aiReasoning}>
                      {log.aiReasoning}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
