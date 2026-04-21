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
  isSandbox: z.boolean(),
  accountId: z.string().optional().nullable(),
  maxOrderAmount: z.coerce.number().min(100).max(10000000),
  riskPercent: z.coerce.number().min(0.1).max(100),
  agentIntervalMinutes: z.coerce.number().min(1).max(1440),
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
        toast({ title: "Settings updated", description: "Your configuration has been saved successfully." });
      },
      onError: (err: any) => {
        toast({ title: "Error saving settings", description: err?.message || "An unknown error occurred", variant: "destructive" });
      }
    }
  });

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      token: "",
      isSandbox: true,
      accountId: null,
      maxOrderAmount: 10000,
      riskPercent: 2,
      agentIntervalMinutes: 15,
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        token: "", // Never display the real token
        isSandbox: settings.isSandbox,
        accountId: settings.accountId,
        maxOrderAmount: settings.maxOrderAmount,
        riskPercent: settings.riskPercent,
        agentIntervalMinutes: settings.agentIntervalMinutes,
      });
    }
  }, [settings, form]);

  const onSubmit = (data: SettingsFormValues) => {
    const payload = { ...data };
    if (!payload.token) delete payload.token; // Don't send empty string if not changing
    updateSettings.mutate({ data: payload });
  };

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-[600px] w-full max-w-2xl mx-auto" /></div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
        <p className="text-muted-foreground mt-1">Manage API connection and risk parameters</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card className="bg-card border-card-border">
            <CardHeader>
              <CardTitle>API Connection</CardTitle>
              <CardDescription>Configure your Tinkoff Invest API credentials</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="token"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Token</FormLabel>
                    <FormControl>
                      <Input 
                        type="password" 
                        placeholder={settings?.hasToken ? "•••••••••••••••••••••••• (Set)" : "t.*******************"} 
                        {...field} 
                        className="font-mono bg-background"
                      />
                    </FormControl>
                    <FormDescription>
                      Leave blank to keep current token. Your token is encrypted at rest.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-6">
                <FormField
                  control={form.control}
                  name="isSandbox"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4 w-1/2 bg-background">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Sandbox Mode</FormLabel>
                        <FormDescription>Use paper money</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="accountId"
                  render={({ field }) => (
                    <FormItem className="w-1/2">
                      <FormLabel>Trading Account</FormLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="bg-background">
                            <SelectValue placeholder="Select account" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {accounts?.map((acc) => (
                            <SelectItem key={acc.id} value={acc.id}>
                              {acc.name} ({acc.id.slice(-4)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-card-border">
            <CardHeader>
              <CardTitle>AI Agent Parameters</CardTitle>
              <CardDescription>Set the trading bounds for the autonomous agent</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="maxOrderAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Position Size (₽)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} className="bg-background font-mono" />
                      </FormControl>
                      <FormDescription>Maximum capital per asset</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="riskPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Risk (%)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.1" {...field} className="bg-background font-mono" />
                      </FormControl>
                      <FormDescription>Stop-loss threshold</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="agentIntervalMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Analysis Interval (min)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} className="bg-background font-mono" />
                      </FormControl>
                      <FormDescription>How often the agent wakes up</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
            <CardFooter className="bg-muted/30 px-6 py-4 border-t border-border">
              <Button type="submit" disabled={updateSettings.isPending} className="w-full font-bold">
                {updateSettings.isPending ? "Saving..." : "Save Configuration"}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </Form>
    </div>
  );
}
