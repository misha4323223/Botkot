import { useGetSettings, useUpdateSettings, useListAccounts, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const settingsSchema = z.object({
  token: z.string().optional().or(z.literal("")),
  accountId: z.string().optional().nullable(),
  maxOrderAmount: z.coerce.number().min(100).max(10000000),
  riskPercent: z.coerce.number().min(0.1).max(100),
  agentIntervalMinutes: z.coerce.number().min(1).max(1440),
  paperMode: z.boolean(),
  confidenceThreshold: z.coerce.number().min(0).max(100),
  stopLossPercent: z.coerce.number().min(0.1).max(50),
  takeProfitPercent: z.coerce.number().min(0.1).max(100),
  dailyLossLimitRub: z.coerce.number().min(0).max(10000000),
  maxTradesPerDay: z.coerce.number().min(0).max(1000),
  priceLimitPercent: z.coerce.number().min(0).max(20),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export default function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetSettings();
  const { data: accounts } = useListAccounts();

  const updateSettings = useUpdateSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({ title: "Настройки сохранены" });
      },
      onError: (err: any) => {
        toast({ title: "Ошибка сохранения", description: err?.message || "Неизвестная ошибка", variant: "destructive" });
      }
    }
  });

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      token: "",
      accountId: null,
      maxOrderAmount: 10000,
      riskPercent: 2,
      agentIntervalMinutes: 60,
      paperMode: true,
      confidenceThreshold: 80,
      stopLossPercent: 2,
      takeProfitPercent: 4,
      dailyLossLimitRub: 5000,
      maxTradesPerDay: 5,
      priceLimitPercent: 0.3,
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        token: "",
        accountId: settings.accountId,
        maxOrderAmount: settings.maxOrderAmount,
        riskPercent: settings.riskPercent,
        agentIntervalMinutes: settings.agentIntervalMinutes,
        paperMode: settings.paperMode,
        confidenceThreshold: settings.confidenceThreshold,
        stopLossPercent: settings.stopLossPercent,
        takeProfitPercent: settings.takeProfitPercent,
        dailyLossLimitRub: settings.dailyLossLimitRub,
        maxTradesPerDay: settings.maxTradesPerDay,
        priceLimitPercent: settings.priceLimitPercent,
      });
    }
  }, [settings, form]);

  const onSubmit = (data: SettingsFormValues) => {
    const payload: any = { ...data };
    if (!payload.token) delete payload.token;
    updateSettings.mutate({ data: payload });
  };

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-[600px] w-full max-w-2xl mx-auto" /></div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Настройки</h1>
        <p className="text-muted-foreground mt-1">API подключение, режим и параметры риск-менеджмента</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Подключение к Tinkoff Invest</CardTitle>
              <CardDescription>Боевой токен. Хранится зашифрованным.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="token" render={({ field }) => (
                <FormItem>
                  <FormLabel>API-токен</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder={settings?.hasToken ? "•••••••••• (установлен)" : "t.****"} {...field} className="font-mono" />
                  </FormControl>
                  <FormDescription>Оставьте пустым, чтобы не менять.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="accountId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Торговый счёт</FormLabel>
                  <Select value={field.value || undefined} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Выберите счёт" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {accounts?.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>{acc.name} ({acc.id.slice(-4)})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Режим работы</CardTitle>
              <CardDescription>Paper-режим логирует решения, но не отправляет ордера в банк.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="paperMode" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Paper trading</FormLabel>
                    <FormDescription>
                      {field.value ? "Включён: симуляция, реальных сделок нет." : "ВЫКЛЮЧЕН — сделки идут на боевой счёт!"}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="confidenceThreshold" render={({ field }) => (
                <FormItem>
                  <FormLabel>Минимальная уверенность для сделки (%)</FormLabel>
                  <FormControl><Input type="number" {...field} className="font-mono" /></FormControl>
                  <FormDescription>Решения с confidence ниже порога не исполняются.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="agentIntervalMinutes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Интервал анализа (мин)</FormLabel>
                  <FormControl><Input type="number" {...field} className="font-mono" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Риск-менеджмент</CardTitle>
              <CardDescription>Стопы, тейки и дневные лимиты.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="maxOrderAmount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Макс. размер позиции (₽)</FormLabel>
                  <FormControl><Input type="number" {...field} className="font-mono" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="riskPercent" render={({ field }) => (
                <FormItem>
                  <FormLabel>Риск (%)</FormLabel>
                  <FormControl><Input type="number" step="0.1" {...field} className="font-mono" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="stopLossPercent" render={({ field }) => (
                <FormItem>
                  <FormLabel>Стоп-лосс (%)</FormLabel>
                  <FormControl><Input type="number" step="0.1" {...field} className="font-mono" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="takeProfitPercent" render={({ field }) => (
                <FormItem>
                  <FormLabel>Тейк-профит (%)</FormLabel>
                  <FormControl><Input type="number" step="0.1" {...field} className="font-mono" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="dailyLossLimitRub" render={({ field }) => (
                <FormItem>
                  <FormLabel>Дневной лимит убытка (₽)</FormLabel>
                  <FormControl><Input type="number" {...field} className="font-mono" /></FormControl>
                  <FormDescription>0 = без лимита</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="maxTradesPerDay" render={({ field }) => (
                <FormItem>
                  <FormLabel>Макс. сделок в день</FormLabel>
                  <FormControl><Input type="number" {...field} className="font-mono" /></FormControl>
                  <FormDescription>0 = без лимита</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="priceLimitPercent" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Допуск цены лимит-ордера (%)</FormLabel>
                  <FormControl><Input type="number" step="0.1" {...field} className="font-mono" /></FormControl>
                  <FormDescription>Сколько % от текущей цены агенту разрешено «приплатить» для исполнения.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
            <CardFooter className="bg-muted/30 border-t">
              <Button type="submit" disabled={updateSettings.isPending} className="w-full font-bold">
                {updateSettings.isPending ? "Сохраняем…" : "Сохранить"}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </Form>
    </div>
  );
}
