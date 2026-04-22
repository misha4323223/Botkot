import { useListOrders, useListTradeLogs, useGetTradeStats, useCancelOrder, getListOrdersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Target, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { QuickTrade } from "@/components/quick-trade";

const ACTION_LABEL: Record<string, string> = {
  buy: "Купить",
  sell: "Продать",
  hold: "Держать",
  analyze: "Анализ",
};

const DIRECTION_LABEL: Record<string, string> = {
  buy: "Покупка",
  sell: "Продажа",
};

function actionColor(action: string) {
  if (action === "buy") return "text-success";
  if (action === "sell") return "text-destructive";
  return "text-primary";
}

export default function OrdersPage() {
  const queryClient = useQueryClient();
  const { data: activeOrders, isLoading: isLoadingOrders } = useListOrders();
  const { data: tradeLogs, isLoading: isLoadingLogs } = useListTradeLogs({ limit: 50 });
  const { data: stats, isLoading: isLoadingStats } = useGetTradeStats();

  const cancelOrder = useCancelOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      },
    },
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-1 sm:px-0">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Ордера и история</h1>
      </div>

      <QuickTrade />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <Card className="bg-card border-card-border">
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Всего сделок</p>
            {isLoadingStats ? <Skeleton className="h-6 w-16" /> : <p className="text-xl sm:text-2xl font-bold">{stats?.totalTrades || 0}</p>}
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border">
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Win-rate</p>
            {isLoadingStats ? <Skeleton className="h-6 w-16" /> : <p className="text-xl sm:text-2xl font-bold text-primary">{stats ? `${(stats.winRate * 100).toFixed(1)}%` : "0%"}</p>}
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border">
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Реализованный P&L</p>
            {isLoadingStats ? (
              <Skeleton className="h-6 w-24" />
            ) : (
              <p className={`text-xl sm:text-2xl font-bold ${stats && stats.totalPnl >= 0 ? "text-success" : "text-destructive"}`}>
                {stats && stats.totalPnl >= 0 ? "+" : ""}₽{stats?.totalPnl.toFixed(2) || "0.00"}
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border">
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">Среднее удержание</p>
            {isLoadingStats ? <Skeleton className="h-6 w-16" /> : <p className="text-xl sm:text-2xl font-bold">{stats?.avgHoldingHours.toFixed(1)} ч</p>}
          </CardContent>
        </Card>
      </div>

      {/* Active orders */}
      <Card className="bg-card border-card-border">
        <CardHeader className="border-b border-border pb-4 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            <CardTitle className="text-base sm:text-lg">Активные ордера</CardTitle>
          </div>
          <Badge variant="secondary">{activeOrders?.length || 0}</Badge>
        </CardHeader>

        {/* Mobile: cards */}
        <div className="md:hidden p-3 space-y-3">
          {isLoadingOrders ? (
            <Skeleton className="h-20 w-full" />
          ) : activeOrders?.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">Активных ордеров нет</p>
          ) : (
            activeOrders?.map((order) => (
              <div key={order.orderId} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold font-mono">{order.ticker || order.figi}</span>
                  <Badge variant="outline" className={order.direction === "buy" ? "border-success text-success" : "border-destructive text-destructive"}>
                    {DIRECTION_LABEL[order.direction] ?? order.direction.toUpperCase()}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Кол-во</p>
                    <p className="font-mono">{order.quantity}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Лимит цены</p>
                    <p className="font-mono">{order.price ? `₽${order.price.toFixed(2)}` : "Рыночная"}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Статус</p>
                    <p>{order.status}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => cancelOrder.mutate({ orderId: order.orderId, accountId: "" })}
                  disabled={cancelOrder.isPending}
                >
                  Отменить
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Desktop: table */}
        <div className="hidden md:block p-0 overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase text-muted-foreground bg-muted/50 border-b border-border">
              <tr>
                <th className="px-6 py-3 font-medium">Бумага</th>
                <th className="px-6 py-3 font-medium">Тип</th>
                <th className="px-6 py-3 font-medium text-right">Кол-во</th>
                <th className="px-6 py-3 font-medium text-right">Лимит цены</th>
                <th className="px-6 py-3 font-medium">Статус</th>
                <th className="px-6 py-3 font-medium text-right">Действие</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingOrders ? (
                <tr><td colSpan={6} className="px-6 py-4"><Skeleton className="h-6 w-full" /></td></tr>
              ) : activeOrders?.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Активных ордеров нет</td></tr>
              ) : (
                activeOrders?.map((order) => (
                  <tr key={order.orderId} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-6 py-4 font-bold text-card-foreground font-mono">{order.ticker || order.figi}</td>
                    <td className="px-6 py-4">
                      <Badge variant="outline" className={order.direction === "buy" ? "border-success text-success" : "border-destructive text-destructive"}>
                        {DIRECTION_LABEL[order.direction] ?? order.direction.toUpperCase()} {order.type.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right font-mono">{order.quantity}</td>
                    <td className="px-6 py-4 text-right font-mono">{order.price ? `₽${order.price.toFixed(2)}` : "Рыночная"}</td>
                    <td className="px-6 py-4 text-muted-foreground">{order.status}</td>
                    <td className="px-6 py-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => cancelOrder.mutate({ orderId: order.orderId, accountId: "" })}
                        disabled={cancelOrder.isPending}
                      >
                        Отменить
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Trade history */}
      <Card className="bg-card border-card-border">
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="text-base sm:text-lg">История сделок и решения ИИ</CardTitle>
        </CardHeader>

        {/* Mobile: cards */}
        <div className="md:hidden p-3 space-y-3">
          {isLoadingLogs ? (
            <Skeleton className="h-32 w-full" />
          ) : tradeLogs?.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">История сделок пуста</p>
          ) : (
            tradeLogs?.map((log) => (
              <div key={log.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {log.success ? (
                      <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-destructive shrink-0" />
                    )}
                    <span className="font-bold font-mono truncate">{log.ticker}</span>
                    <span className={`text-xs uppercase font-medium ${actionColor(log.action)}`}>
                      {ACTION_LABEL[log.action] ?? log.action}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                    {format(new Date(log.createdAt), "d MMM HH:mm", { locale: ru })}
                  </span>
                </div>

                {log.quantity && log.price ? (
                  <div className="text-xs font-mono text-muted-foreground">
                    {log.quantity} шт. @ ₽{log.price.toFixed(2)}
                  </div>
                ) : null}

                <p className="text-sm text-card-foreground leading-relaxed whitespace-pre-wrap break-words">
                  {log.aiReasoning}
                </p>

                {log.errorMessage && (
                  <div className="text-xs text-destructive flex items-start gap-1">
                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                    <span className="break-words">{log.errorMessage}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Desktop: table */}
        <div className="hidden md:block p-0 overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase text-muted-foreground bg-muted/50 border-b border-border">
              <tr>
                <th className="px-6 py-3 font-medium w-40">Время</th>
                <th className="px-6 py-3 font-medium w-32">Бумага</th>
                <th className="px-6 py-3 font-medium w-28">Действие</th>
                <th className="px-6 py-3 font-medium w-32 text-right">Детали</th>
                <th className="px-6 py-3 font-medium">Обоснование ИИ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoadingLogs ? (
                <tr><td colSpan={5} className="px-6 py-4"><Skeleton className="h-20 w-full" /></td></tr>
              ) : tradeLogs?.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">История сделок пуста</td></tr>
              ) : (
                tradeLogs?.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/30">
                    <td className="px-6 py-4 text-muted-foreground font-mono text-xs align-top">
                      {format(new Date(log.createdAt), "d MMM, HH:mm:ss", { locale: ru })}
                    </td>
                    <td className="px-6 py-4 font-bold text-card-foreground font-mono align-top">{log.ticker}</td>
                    <td className="px-6 py-4 align-top">
                      <div className="flex items-center gap-2">
                        {log.success ? (
                          <CheckCircle2 className="w-4 h-4 text-success" />
                        ) : (
                          <XCircle className="w-4 h-4 text-destructive" />
                        )}
                        <span className={`uppercase font-medium ${actionColor(log.action)}`}>
                          {ACTION_LABEL[log.action] ?? log.action}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right align-top">
                      {log.quantity && log.price ? (
                        <div className="font-mono text-xs">
                          <div>{log.quantity} шт.</div>
                          <div className="text-muted-foreground">@ ₽{log.price.toFixed(2)}</div>
                        </div>
                      ) : "—"}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-card-foreground leading-relaxed whitespace-pre-wrap">{log.aiReasoning}</p>
                      {log.errorMessage && (
                        <div className="mt-2 text-xs text-destructive flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> {log.errorMessage}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
