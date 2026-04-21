import { useGetPortfolio, useListAccounts, useGetPortfolioSummary } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";

export default function PortfolioPage() {
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  
  const { data: accounts, isLoading: isLoadingAccounts } = useListAccounts();
  const { data: portfolio, isLoading: isLoadingPortfolio } = useGetPortfolio();
  const { data: summary } = useGetPortfolioSummary();

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>
        
        <div className="flex items-center space-x-4">
          <Select value={selectedAccount} onValueChange={setSelectedAccount}>
            <SelectTrigger className="w-[250px] bg-card border-card-border">
              <SelectValue placeholder="Select Account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Accounts</SelectItem>
              {accounts?.map((acc) => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.name} ({acc.id.slice(-4)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="bg-card border-card-border p-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-1">Total Value</p>
          {summary ? (
            <p className="text-3xl font-bold font-mono">₽{summary.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          ) : <Skeleton className="h-8 w-32" />}
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-1">Total P&L</p>
          {summary ? (
            <p className={`text-2xl font-bold font-mono ${summary.totalPnl >= 0 ? "text-success" : "text-destructive"}`}>
              {summary.totalPnl >= 0 ? "+" : ""}₽{summary.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-sm ml-2">({summary.totalPnl >= 0 ? "+" : ""}{summary.totalPnlPercent.toFixed(2)}%)</span>
            </p>
          ) : <Skeleton className="h-8 w-32" />}
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-1">Cash Balance</p>
          {summary ? (
            <p className="text-2xl font-bold font-mono">₽{summary.cashRub.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          ) : <Skeleton className="h-8 w-32" />}
        </div>
      </Card>

      <Card className="bg-card border-card-border flex-1 flex flex-col overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase text-muted-foreground bg-muted/50 border-b border-border sticky top-0">
              <tr>
                <th className="px-6 py-4 font-medium">Asset</th>
                <th className="px-6 py-4 font-medium">Type</th>
                <th className="px-6 py-4 font-medium text-right">Quantity</th>
                <th className="px-6 py-4 font-medium text-right">Avg Price</th>
                <th className="px-6 py-4 font-medium text-right">Current Price</th>
                <th className="px-6 py-4 font-medium text-right">Value</th>
                <th className="px-6 py-4 font-medium text-right">P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoadingPortfolio ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-6 py-4"><Skeleton className="h-6 w-full" /></td>
                  </tr>
                ))
              ) : portfolio?.positions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                    No positions found in this account.
                  </td>
                </tr>
              ) : (
                portfolio?.positions.map((pos) => (
                  <tr key={pos.figi} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-card-foreground">{pos.ticker}</div>
                      <div className="text-xs text-muted-foreground">{pos.name}</div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant="outline" className="text-xs uppercase">{pos.instrumentType}</Badge>
                    </td>
                    <td className="px-6 py-4 text-right font-mono">{pos.quantity}</td>
                    <td className="px-6 py-4 text-right font-mono text-muted-foreground">₽{pos.averagePrice.toFixed(2)}</td>
                    <td className="px-6 py-4 text-right font-mono font-medium">₽{pos.currentPrice.toFixed(2)}</td>
                    <td className="px-6 py-4 text-right font-mono">₽{pos.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className={`px-6 py-4 text-right font-mono font-medium ${pos.unrealizedPnl >= 0 ? "text-success" : "text-destructive"}`}>
                      {pos.unrealizedPnl >= 0 ? "+" : ""}₽{pos.unrealizedPnl.toFixed(2)}
                      <div className="text-xs opacity-80">
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
  );
}
