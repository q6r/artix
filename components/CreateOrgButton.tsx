"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus, X } from "lucide-react";
import Select from "@/components/Select";
import { useLang } from "@/components/LanguageProvider";

const inputCls =
  "h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/35 focus:border-white/30";

export default function CreateOrgButton() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState("Cloud 2");

  const close = () => {
    setOpen(false);
    setName("");
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
      >
        <Plus className="h-4 w-4" />
        {t("dash.createOrg.title")}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.div
              role="dialog"
              aria-label={t("dash.createOrg.title")}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0a] p-6"
            >
              <button
                onClick={close}
                aria-label={t("dash.createOrg.close")}
                className="absolute right-4 top-4 rounded-md p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>

              <h2 className="text-lg font-semibold tracking-tight">
                {t("dash.createOrg.title")}
              </h2>
              <p className="mt-1 text-sm text-white/50">
                {t("dash.createOrg.subtitle")}
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  close();
                }}
                className="mt-5 flex flex-col gap-4"
              >
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium">{t("dash.createOrg.name")}</span>
                  <input
                    autoFocus
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("dash.createOrg.namePlaceholder")}
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium">{t("dash.createOrg.plan")}</span>
                  <Select
                    value={plan}
                    onChange={setPlan}
                    className="h-11 px-4 text-sm"
                    options={[
                      { value: "Cloud 2", label: "Cloud 2" },
                      { value: "Cloud 4", label: "Cloud 4" },
                      { value: "Cloud 8", label: "Cloud 8" },
                    ]}
                  />
                </label>
                <div className="mt-1 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="h-10 rounded-full border border-white/15 bg-white/5 px-4 text-sm transition-colors hover:bg-white/10"
                  >
                    {t("dash.createOrg.cancel")}
                  </button>
                  <button
                    type="submit"
                    className="h-10 rounded-full bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85"
                  >
                    {t("dash.createOrg.create")}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
