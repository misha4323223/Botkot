import { useState } from "react";
import { useListOrders, useListTradeLogs, useGetTradeStats, useCancelOrder, getListOrdersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Target, XCircle, CheckCircle2, AlertCircle } from "lucide-react";

export default function OrdersPage() {
  const queryClient = useQueryClient();
  const { data: activeOrders, isLoading: isLoadingOrders } = useListOrders();
  const { data: tradeLogs, isLoading: isLoadingLogs } = useListTradeLogs({ limit: 50 });
  const { data: stats, isLoading: isLoadingStats } = useGetTradeStats();

  const cancelOrder = useCancelOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      }
    }
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Orders & History</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground mb-1">Total Trades</p>
            {isLoadingStats ? <Skeleton className="h-6 w-16"/> : <p className="text-2xl font-bold">{stats?.totalTrades || 0}</p>}
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground mb-1">Win Rate</p>
            {isLoadingStats ? <Skeleton className="h-6 w-16"/> : <p className="text-2xl font-bold text-primary">{stats ? `${(stats.winRate * 100).toFixed(1)}%` : '0%'}</p>}
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground mb-1">Realized P&L</p>
            {isLoadingStats ? <Skeleton className="h-6 w-24"/> : <p className={`text-2xl font-bold ${stats && stats.totalPnl >= 0 ? 'text-success' : 'text-destructive'}`}>
              {stats && stats.totalPnl >= 0 ? '+' : ''}₽{stats?.totalPnl.toFixed(2) || '0.00'}
            </p>}
          </CardContent>
        </Card>
        <Card className="bg-card border-card-border">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground mb-1">Avg Hold Time</p>
            {isLoadingStats ? <Skeleton className="h-6 w-16"/> : <p className="text-2xl font-bold">{stats?.avgHoldingHours.toFixed(1)}h</p>}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-card-border mb-8">
        <CardHeader className="border-b border-border pb-4 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            <CardTitle>Active Orders</CardTitle>
          </div>
          <Badge variant="secondary">{activeOrders?.length || 0}</Badge>
        </CardHeader>
        <div className="p-0 overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase text-muted-foreground bg-muted/50 border-b border-border">
              <tr>
                <th className="px-6 py-3 font-medium">Asset</th>
                <th className="px-6 py-3 font-medium">Type</th>
                <th className="px-6 py-3 font-medium text-right">Qty</th>
                <th className="px-6 py-3 font-medium text-right">Price Limit</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingOrders ? (
                <tr><td colSpan={6} className="px-6 py-4"><Skeleton className="h-6 w-full" /></td></tr>
              ) : activeOrders?.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No active orders</td></tr>
              ) : (
                activeOrders?.map((order) => (
                  <tr key={order.orderId} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-6 py-4 font-bold text-card-foreground font-mono">{order.ticker || order.figi}</td>
                    <td className="px-6 py-4">
                      <Badge variant="outline" className={order.direction === 'buy' ? 'border-success text-success' : 'border-destructive text-destructive'}>
                        {order.direction.toUpperCase()} {order.type.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right font-mono">{order.quantity}</td>
                    <td className="px-6 py-4 text-right font-mono">{order.price ? `₽${order.price.toFixed(2)}` : 'MKT'}</td>
                    <td className="px-6 py-4 text-muted-foreground">{order.status}</td>
                    <td className="px-6 py-4 text-right">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => cancelOrder.mutate({ orderId: order.orderId, accountId: "" })}
                        disabled={cancelOrder.isPending}
                      >
                        Cancel
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="bg-card border-card-border">
        <CardHeader className="border-b border-border pb-4">
          <CardTitle>Trade History & AI Reasoning</CardTitle>
        </CardHeader>
        <div className="p-0 overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase text-muted-foreground bg-muted/50 border-b border-border">
              <tr>
                <th className="px-6 py-3 font-medium w-40">Time</th>
                <th className="px-6 py-3 font-medium w-32">Asset</th>
                <th className="px-6 py-3 font-medium w-24">Action</th>
                <th className="px-6 py-3 font-medium w-24 text-right">Details</th>
                <th className="px-6 py-3 font-medium">AI Reasoning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoadingLogs ? (
                <tr><td colSpan={5} className="px-6 py-4"><Skeleton className="h-20 w-full" /></td></tr>
              ) : tradeLogs?.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">No trade history available</td></tr>
              ) : (
                tradeLogs?.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/30">
                    <td className="px-6 py-4 text-muted-foreground font-mono text-xs align-top">
                      {format(new Date(log.createdAt), "MMM dd, HH:mm:ss")}
                    </td>
                    <td className="px-6 py-4 font-bold text-card-foreground font-mono align-top">
                      {log.ticker}
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="flex items-center gap-2">
                        {log.success ? (
                          <CheckCircle2 className="w-4 h-4 text-success" />
                        ) : (
                          <XCircle className="w-4 h-4 text-destructive" />
                        )}
                        <span className={`uppercase font-medium ${
                          log.action === 'buy' ? 'text-success' : 
                          log.action === 'sell' ? 'text-destructive' : 
                          'text-primary'
                        }`}>{log.action}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right align-top">
                      {log.quantity && log.price ? (
                        <div className="font-mono text-xs">
                          <div>{log.quantity} units</div>
                          <div className="text-muted-foreground">@ ₽{log.price.toFixed(2)}</div>
                        </div>
                      ) : '-'}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-card-foreground leading-relaxed">{log.aiReasoning}</p>
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
