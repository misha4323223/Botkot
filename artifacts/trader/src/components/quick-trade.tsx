import { useState } from "react";
import {
  useSearchInstruments,
  useGetLastPrice,
  usePlaceOrder,
  getListOrdersQueryKey,
  getListTradeLogsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, TrendingDown, Search, Zap } from "lucide-react";

interface Instrument {
  figi: string;
  ticker: string;
  name: string;
  type: string;
  currency: string;
  exchange: string;
  lot: number;
}

export function QuickTrade() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [quantity, setQuantity] = useState<number>(1);
  const [limitPrice, setLimitPrice] = useState<string>("");

  // Debounce search
  useState(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  });

  const { data: instruments, isFetching: isSearching } = useSearchInstruments(
    { query: debouncedQuery, type: "stock" },
    { query: { enabled: debouncedQuery.length >= 2 } }
  );

  const { data: lastPrice } = useGetLastPrice(selected?.figi ?? "", {
    query: { enabled: !!selected, refetchInterval: 5000 },
  });

  const placeOrder = usePlaceOrder({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: direction === "buy" ? "Покупка отправлена" : "Продажа отправлена",
          description: `${selected?.ticker}: ${quantity} лот(ов) — статус ${data.status}`,
        });
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListTradeLogsQueryKey() });
      },
      onError: (err: Error) => {
        toast({
          title: "Ошибка размещения ордера",
          description: err.message ?? "Неизвестная ошибка",
          variant: "destructive",
        });
      },
    },
  });

  const handleSubmit = () => {
    if (!selected) {
      toast({ title: "Выберите инструмент", variant: "destructive" });
      return;
    }
    if (quantity < 1) {
      toast({ title: "Количество должно быть ≥ 1", variant: "destructive" });
      return;
    }
    if (orderType === "limit" && (!limitPrice || Number(limitPrice) <= 0)) {
      toast({ title: "Укажите цену для лимитного ордера", variant: "destructive" });
      return;
    }

    placeOrder.mutate({
      data: {
        figi: selected.figi,
        direction,
        quantity,
        orderType,
        price: orderType === "limit" ? Number(limitPrice) : null,
      },
    });
  };

  const estimatedTotal =
    selected && lastPrice
      ? (orderType === "limit" && limitPrice ? Number(limitPrice) : lastPrice.price) *
        quantity *
        (selected.lot ?? 1)
      : 0;

  return (
    <Card className="bg-card border-card-border">
      <CardHeader className="border-b border-border pb-4">
        <CardTitle className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" />
          Купить / Продать
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {/* Search */}
        <div className="space-y-2">
          <Label>Инструмент</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Тикер или название (например, SBER, Газпром)"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setDebouncedQuery(e.target.value);
              }}
              className="pl-9 bg-background"
            />
          </div>
          {debouncedQuery.length >= 2 && !selected && (
            <div className="border border-border rounded-md max-h-48 overflow-y-auto bg-background">
              {isSearching ? (
                <div className="p-3 text-sm text-muted-foreground">Ищу…</div>
              ) : instruments && instruments.length > 0 ? (
                instruments.slice(0, 10).map((i) => (
                  <button
                    key={i.figi}
                    type="button"
                    onClick={() => {
                      setSelected(i as Instrument);
                      setQuery(`${i.ticker} — ${i.name}`);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-muted/50 text-sm border-b border-border last:border-0 flex justify-between items-center"
                  >
                    <span>
                      <span className="font-mono font-bold">{i.ticker}</span>{" "}
                      <span className="text-muted-foreground">— {i.name}</span>
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {i.exchange}
                    </Badge>
                  </button>
                ))
              ) : (
                <div className="p-3 text-sm text-muted-foreground">Ничего не найдено</div>
              )}
            </div>
          )}
          {selected && (
            <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
              <div>
                <span className="font-mono font-bold">{selected.ticker}</span>{" "}
                <span className="text-muted-foreground">— {selected.name}</span>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Лот: {selected.lot} · {selected.exchange}
                  {lastPrice && (
                    <>
                      {" · "}Текущая цена:{" "}
                      <span className="font-mono text-foreground">
                        ₽{lastPrice.price.toFixed(2)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelected(null);
                  setQuery("");
                  setDebouncedQuery("");
                }}
              >
                Сменить
              </Button>
            </div>
          )}
        </div>

        {/* Direction toggle */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={direction === "buy" ? "default" : "outline"}
            className={
              direction === "buy"
                ? "bg-success hover:bg-success/90 text-success-foreground"
                : ""
            }
            onClick={() => setDirection("buy")}
          >
            <TrendingUp className="w-4 h-4 mr-2" />
            Купить
          </Button>
          <Button
            type="button"
            variant={direction === "sell" ? "default" : "outline"}
            className={
              direction === "sell"
                ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                : ""
            }
            onClick={() => setDirection("sell")}
          >
            <TrendingDown className="w-4 h-4 mr-2" />
            Продать
          </Button>
        </div>

        {/* Order type & quantity */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Тип ордера</Label>
            <Select value={orderType} onValueChange={(v) => setOrderType(v as "market" | "limit")}>
              <SelectTrigger className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="market">Рыночный</SelectItem>
                <SelectItem value="limit">Лимитный</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Количество лотов</Label>
            <Input
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
              className="bg-background font-mono"
            />
          </div>
        </div>

        {orderType === "limit" && (
          <div className="space-y-2">
            <Label>Цена (₽)</Label>
            <Input
              type="number"
              step="0.01"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={lastPrice ? lastPrice.price.toFixed(2) : "0.00"}
              className="bg-background font-mono"
            />
          </div>
        )}

        {/* Summary */}
        {selected && (
          <div className="rounded-md bg-muted/30 border border-border p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Инструмент</span>
              <span className="font-mono font-bold">{selected.ticker}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Лотов × Размер лота</span>
              <span className="font-mono">
                {quantity} × {selected.lot} = {quantity * selected.lot} шт.
              </span>
            </div>
            {estimatedTotal > 0 && (
              <div className="flex justify-between pt-1 border-t border-border">
                <span className="text-muted-foreground">Примерная сумма</span>
                <span className="font-mono font-bold">
                  ≈ ₽{estimatedTotal.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}

        <Button
          onClick={handleSubmit}
          disabled={placeOrder.isPending || !selected}
          className={`w-full font-bold ${
            direction === "buy"
              ? "bg-success hover:bg-success/90 text-success-foreground"
              : "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          }`}
        >
          {placeOrder.isPending
            ? "Отправка…"
            : direction === "buy"
              ? `Купить ${selected?.ticker ?? ""}`.trim()
              : `Продать ${selected?.ticker ?? ""}`.trim()}
        </Button>
      </CardContent>
    </Card>
  );
}
