import { useState, useRef } from "react";
import { useSearchInstruments, useGetCandles, useAddToWatchlist, useGetWatchlist, getGetWatchlistQueryKey, useGetLastPrice } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, Plus, Check, ArrowLeft } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart } from "recharts";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

export default function MarketPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedFigi, setSelectedFigi] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queryClient = useQueryClient();

  const { data: searchResults, isLoading: isSearching } = useSearchInstruments(
    { query: debouncedQuery },
    { query: { enabled: debouncedQuery.length > 1 } }
  );

  const { data: watchlist } = useGetWatchlist();
  const addToWatchlist = useAddToWatchlist({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() })
    }
  });

  const { data: candles, isLoading: isLoadingCandles } = useGetCandles(selectedFigi || "", { interval: "day" }, {
    query: { enabled: !!selectedFigi }
  });

  const { data: lastPrice } = useGetLastPrice(selectedFigi || "", {
    query: { enabled: !!selectedFigi }
  });

  const handleSearchChange = (val: string) => {
    setQuery(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedQuery(val), 400);
  };

  const selectedInstrument = searchResults?.find(r => r.figi === selectedFigi) || null;
  const isWatched = watchlist?.some(w => w.figi === selectedFigi);

  const chartData = candles?.map(c => ({
    time: format(new Date(c.time), "dd.MM"),
    price: c.close,
    volume: c.volume
  })) || [];

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">Рынок</h1>

      {/* Mobile: show detail back button when instrument selected */}
      {selectedFigi && selectedInstrument && (
        <div className="lg:hidden">
          <button
            onClick={() => setSelectedFigi(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" /> Назад к поиску
          </button>
        </div>
      )}

      <div className="flex gap-4 lg:gap-6">
        {/* Search panel — hidden on mobile when instrument is selected */}
        <Card className={`bg-card border-border flex flex-col w-full lg:w-80 lg:shrink-0 ${selectedFigi && selectedInstrument ? "hidden lg:flex" : "flex"}`}>
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input 
                placeholder="Поиск акций... (SBER, YNDX)"
                className="pl-9 bg-background border-border h-9"
                value={query}
                onChange={e => handleSearchChange(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5 max-h-[70vh] lg:max-h-none">
            {debouncedQuery.length < 2 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Введите тикер или название
              </div>
            ) : isSearching ? (
              <div className="p-3 space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : !searchResults?.length ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Ничего не найдено</div>
            ) : (
              searchResults.map((inst) => (
                <button
                  key={inst.figi}
                  className={`w-full text-left p-3 rounded-md transition-colors flex flex-col gap-0.5 ${
                    selectedFigi === inst.figi ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedFigi(inst.figi)}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-bold text-sm font-mono">{inst.ticker}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground uppercase">{inst.type}</span>
                  </div>
                  <span className="text-xs text-muted-foreground truncate w-full">{inst.name}</span>
                </button>
              ))
            )}
          </div>
        </Card>

        {/* Detail area — full width on mobile when selected */}
        {selectedFigi && selectedInstrument ? (
          <Card className="flex-1 bg-card border-border p-4 lg:p-6 flex flex-col min-h-[400px]">
            <div className="flex items-start justify-between mb-4 gap-3">
              <div className="min-w-0">
                <h2 className="text-lg lg:text-2xl font-bold truncate">{selectedInstrument.name}</h2>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-muted-foreground font-mono text-sm">{selectedInstrument.ticker}</span>
                  <span className="text-muted-foreground text-xs">•</span>
                  <span className="text-muted-foreground text-xs uppercase">{selectedInstrument.exchange}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="text-xl lg:text-3xl font-bold font-mono">
                  {lastPrice ? `₽${lastPrice.price.toFixed(2)}` : <Skeleton className="h-7 w-20" />}
                </div>
                <Button 
                  variant={isWatched ? "secondary" : "default"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    if (!isWatched) {
                      addToWatchlist.mutate({
                        data: {
                          figi: selectedInstrument.figi,
                          ticker: selectedInstrument.ticker,
                          name: selectedInstrument.name
                        }
                      });
                    }
                  }}
                  disabled={isWatched || addToWatchlist.isPending}
                >
                  {isWatched ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
                  {isWatched ? "В списке" : "В список"}
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-[260px]">
              {isLoadingCandles ? (
                <Skeleton className="w-full h-full min-h-[260px]" />
              ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="price" domain={['auto', 'auto']} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `₽${v}`} width={65} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '6px', fontSize: '12px' }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                      labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                    />
                    <Line yAxisId="price" type="monotone" dataKey="price" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "hsl(var(--primary))" }} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full h-full min-h-[260px] flex items-center justify-center text-muted-foreground text-sm">
                  Нет данных для графика
                </div>
              )}
            </div>
          </Card>
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center text-muted-foreground text-sm">
            Выберите инструмент для просмотра
          </div>
        )}
      </div>
    </div>
  );
}
