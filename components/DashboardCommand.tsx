"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Building2,
  CornerDownLeftIcon,
  CreditCard,
  Globe,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  type LucideIcon,
  Plus,
  Search,
  Server,
} from "lucide-react";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandDialogTrigger,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useLang } from "@/components/LanguageProvider";

type Item = {
  value: string;
  labelKey: string;
  label: string;
  href: string;
  icon: LucideIcon;
  shortcut?: string;
};

type Group = { value: string; labelKey: string; label: string; items: Item[] };

const groups: { value: string; labelKey: string; items: Omit<Item, "label">[] }[] = [
  {
    value: "navigation",
    labelKey: "dash.command.group.navigation",
    items: [
      { value: "overview", labelKey: "dash.command.item.overview", href: "/dashboard", icon: LayoutDashboard },
      { value: "servers", labelKey: "dash.command.item.servers", href: "/dashboard/servers", icon: Server },
      { value: "orgs", labelKey: "dash.command.item.orgs", href: "/dashboard/organizations", icon: Building2 },
      { value: "billing", labelKey: "dash.command.item.billing", href: "/dashboard/billing", icon: CreditCard },
      { value: "support", labelKey: "dash.command.item.support", href: "/dashboard/support", icon: LifeBuoy },
    ],
  },
  {
    value: "actions",
    labelKey: "dash.command.group.actions",
    items: [
      { value: "new-vps", labelKey: "dash.command.item.newVps", href: "/dashboard/servers/new", icon: Plus, shortcut: "⌘N" },
      { value: "site", labelKey: "dash.command.item.site", href: "/", icon: Globe },
      { value: "logout", labelKey: "dash.command.item.logout", href: "/", icon: LogOut },
    ],
  },
];

export default function DashboardCommand() {
  const { t } = useLang();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const localizedGroups: Group[] = groups.map((g) => ({
    value: g.value,
    labelKey: g.labelKey,
    label: t(g.labelKey),
    items: g.items.map((it) => ({ ...it, label: t(it.labelKey) })),
  }));

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const go = (item: Item) => {
    setOpen(false);
    router.push(item.href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandDialogTrigger
        render={
          <button
            type="button"
            className="hidden h-9 w-full max-w-xs items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white/45 transition-colors hover:bg-white/[0.06] lg:flex"
          />
        }
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left mt-0.5">{t("dash.command.search")}</span>
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </CommandDialogTrigger>

      <CommandDialogPopup>
        <Command items={localizedGroups}>
          <CommandInput placeholder={t("dash.command.searchPlaceholder")} className="ps-9" />
          <CommandPanel>
            <CommandEmpty>{t("dash.command.empty")}</CommandEmpty>
            <CommandList>
              {(group: Group) => (
                <Fragment key={group.value}>
                  <CommandGroup items={group.items}>
                    <CommandGroupLabel>{group.label}</CommandGroupLabel>
                    <CommandCollection>
                      {(item: Item) => (
                        <CommandItem
                          key={item.value}
                          value={item.value}
                          onClick={() => go(item)}
                          className="gap-2.5"
                        >
                          <item.icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="flex-1">{item.label}</span>
                          {item.shortcut && (
                            <CommandShortcut>{item.shortcut}</CommandShortcut>
                          )}
                        </CommandItem>
                      )}
                    </CommandCollection>
                  </CommandGroup>
                  <CommandSeparator />
                </Fragment>
              )}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <KbdGroup>
                  <Kbd>
                    <ArrowUpIcon />
                  </Kbd>
                  <Kbd>
                    <ArrowDownIcon />
                  </Kbd>
                </KbdGroup>
                <span>{t("dash.command.footer.navigate")}</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>
                  <CornerDownLeftIcon />
                </Kbd>
                <span>{t("dash.command.footer.open")}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Kbd>Esc</Kbd>
              <span>{t("dash.command.footer.close")}</span>
            </div>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
