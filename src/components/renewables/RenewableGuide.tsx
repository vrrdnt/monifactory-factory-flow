"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Leaf, Search, Zap } from "lucide-react";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import type {
  GuideDetail,
  GuideRecipe,
  GuideResource,
  GuideRoute,
  GuideSearch,
} from "@/lib/renewables/types";
import { recipeMapLabel } from "@/lib/datasets/identity";

const tiers = [
  "ULV",
  "LV",
  "MV",
  "HV",
  "EV",
  "IV",
  "LuV",
  "ZPM",
  "UV",
  "UHV",
  "UEV",
  "UIV",
  "UXV",
  "OpV",
  "MAX",
];
const number = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

function Icon({ resource }: { resource?: GuideResource }) {
  if (!resource || resource.kind === "utility")
    return <Zap aria-hidden className="h-5 w-5 shrink-0 text-amber-300" />;
  return (
    <ResourceIcon
      resource={{ ...resource, kind: resource.kind, amount: 1 }}
      size="sm"
      showAmount={false}
      tooltip={false}
    />
  );
}

function conditionText(c: Record<string, unknown>) {
  if (c.type === "dimension") return `Dimension: ${c.dimension}`;
  if (c.type === "biome") return `Biome: ${c.biome}`;
  if (c.type === "adjacent_fluid")
    return `Adjacent source blocks: ${(c.fluids as string[]).join(", ")}`;
  return Object.entries(c)
    .map(
      ([k, v]) =>
        `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
    )
    .join(" · ");
}

export function RenewableGuide({ initialResource }: { initialResource: string }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("renewable");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(initialResource);
  const [search, setSearch] = useState<GuideSearch>();
  const [detail, setDetail] = useState<GuideDetail>();
  const [searchError, setSearchError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const requestKey = `${q}|${status}|${offset}`;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/renewables?${new URLSearchParams({ q, status, offset: String(offset) })}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setSearch(data);
        setSearchKey(`${q}|${status}|${offset}`);
        setSearchError("");
      } catch (error) {
        if (!controller.signal.aborted)
          setSearchError(error instanceof Error ? error.message : "Could not load resources.");
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, status, offset]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(
          `/api/renewables?${new URLSearchParams({ resource: selected })}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setDetail(data);
        setDetailError("");
      } catch (error) {
        if (!controller.signal.aborted)
          setDetailError(error instanceof Error ? error.message : "Could not load this route.");
      }
    }
    void load();
    return () => controller.abort();
  }, [selected]);

  function select(key: string) {
    setSelected(key);
    window.history.replaceState(null, "", `/renewables?${new URLSearchParams({ resource: key })}`);
  }
  const currentDetail = detail?.resource.key === selected ? detail : undefined;
  const loading = requestKey !== searchKey;

  return (
    <main className="h-dvh overflow-y-auto bg-canvas text-fg">
      <div className="mx-auto max-w-[1500px] px-4 py-6 md:px-8">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Monifactory 0.13.7 · Expert
            </p>
            <h1 className="flex items-center gap-3 text-2xl font-semibold">
              <Leaf className="h-7 w-7 text-emerald-400" /> Renewable resources
            </h1>
          </div>
          <Link
            href="/"
            className="flex items-center gap-2 rounded border border-line-strong px-3 py-2 text-sm hover:bg-surface-raised"
          >
            <ArrowLeft className="h-4 w-4" /> Factory planner
          </Link>
        </header>
        <p className="mb-5 max-w-4xl text-sm leading-6 text-fg-muted">
          Build lines that keep replenishing their inputs. Each route separates ongoing supply from
          the equipment, seeds and catalysts you need to get started.
        </p>
        <nav aria-label="Common renewable resources" className="mb-5 flex flex-wrap gap-2">
          {[
            ["fluid:minecraft:water", "Water"],
            ["item:minecraft:cobblestone", "Cobbleworks"],
            ["item:gtceu:iron_dust", "Iron"],
            ["fluid:gtceu:oxygen", "Oxygen"],
            ["item:gtceu:rubber_ingot", "Rubber"],
            ["fluid:gtceu:ethanol", "Ethanol"],
          ].map(([key, name]) => (
            <button
              key={key}
              onClick={() => select(key)}
              className="rounded-full border border-line-strong px-3 py-1.5 text-xs text-fg-muted hover:border-emerald-700 hover:text-emerald-300"
            >
              {name}
            </button>
          ))}
        </nav>
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Summary
            label="Renewable routes found"
            value={search ? number(search.coverage.renewableResources) : "…"}
          />
          <Summary label="Equipment, seeds and reusable catalysts" value="One-time setup" />
          <Summary label="Ongoing supplies shown separately" value="External inputs" />
        </div>
        <details className="mb-6 rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium">
            How to use these routes · power, maintenance and coverage
          </summary>
          <ul className="mt-4 space-y-3 pl-5 text-sm leading-6 text-fg-muted">
            {search?.rules.map((rule) => (
              <li className="list-disc" key={rule}>
                {rule}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm font-medium text-amber-300">Coverage audit in progress</p>
          {search?.coverage.limitations.map((text) => (
            <p key={text} className="mt-2 text-sm leading-6 text-fg-muted">
              {text}
            </p>
          ))}
          <p className="mt-3 text-sm text-fg-muted">
            No route found means unproven, not nonrenewable. Actual mined deposits remain finite
            inputs until replaced with a renewable source.
          </p>
        </details>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[350px_minmax(0,1fr)]">
          <aside className="min-w-0 rounded-xl border border-line bg-surface p-4 lg:sticky lg:top-4">
            <label htmlFor="resource-search" className="mb-2 block text-sm font-medium">
              Find a resource
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-fg-subtle" aria-hidden />
              <input
                id="resource-search"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setOffset(0);
                }}
                placeholder="Iron, oxygen, rubber…"
                className="h-10 w-full rounded-lg border border-line-strong bg-canvas pl-9 pr-3 text-sm"
              />
            </div>
            <label htmlFor="route-filter" className="sr-only">
              Route status
            </label>
            <select
              id="route-filter"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setOffset(0);
              }}
              className="mt-3 h-9 w-full rounded-lg border border-line-strong bg-canvas px-2 text-sm"
            >
              <option value="renewable">Renewable routes</option>
              <option value="all">All registered resources</option>
              <option value="unproven">No proven route yet</option>
            </select>
            {searchError ? (
              <p role="alert" className="mt-4 text-sm text-red-300">
                {searchError}
              </p>
            ) : (
              <>
                <p aria-live="polite" className="my-3 text-xs text-fg-subtle">
                  {loading ? "Searching…" : `${number(search?.total ?? 0)} resources`}
                </p>
                <div
                  className={`max-h-[50vh] space-y-1 overflow-y-auto lg:max-h-[60vh] ${loading ? "opacity-50" : ""}`}
                  aria-busy={loading}
                >
                  {search?.resources.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => select(r.key)}
                      aria-pressed={selected === r.key}
                      className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left ${selected === r.key ? "border-emerald-600 bg-emerald-950/40" : "border-transparent hover:bg-surface-raised"}`}
                    >
                      <Icon resource={r} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{r.displayName}</span>
                        <span className="block text-xs text-fg-subtle">
                          {r.kind} · {r.id.split(":")[0]}
                          {r.renewable
                            ? ` · ${tiers[r.voltage ?? 0] ?? "High voltage"}`
                            : " · unproven"}
                        </span>
                      </span>
                    </button>
                  ))}
                  {!loading && search?.total === 0 && (
                    <p className="py-6 text-sm text-fg-muted">
                      No matching resources. Try a broader name or change the filter.
                    </p>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <button
                    disabled={offset === 0 || loading}
                    onClick={() => setOffset(Math.max(0, offset - 60))}
                    className="rounded border border-line px-3 py-2 disabled:opacity-30"
                  >
                    Previous
                  </button>
                  <span>
                    {search?.total ? `${offset + 1}–${Math.min(offset + 60, search.total)}` : "0"}
                  </span>
                  <button
                    disabled={!search || offset + 60 >= search.total || loading}
                    onClick={() => setOffset(offset + 60)}
                    className="rounded border border-line px-3 py-2 disabled:opacity-30"
                  >
                    Next
                  </button>
                </div>
              </>
            )}
          </aside>
          <section
            aria-label="Production route"
            className="min-w-0 rounded-xl border border-line bg-surface p-4 md:p-6"
          >
            {detailError ? (
              <p role="alert" className="text-sm text-red-300">
                {detailError}
              </p>
            ) : !currentDetail ? (
              <p role="status" className="text-sm text-fg-muted">
                Loading production route…
              </p>
            ) : (
              <>
                <div className="mb-5 flex items-center gap-3">
                  <Icon resource={currentDetail.resource} />
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold">{currentDetail.resource.displayName}</h2>
                    <p className="break-all text-xs text-fg-subtle">{currentDetail.resource.key}</p>
                  </div>
                </div>
                <p
                  className={`mb-5 rounded-lg border px-3 py-2 text-sm ${currentDetail.renewable ? "border-emerald-800 bg-emerald-950/30 text-emerald-300" : "border-amber-900 bg-amber-950/30 text-amber-300"}`}
                >
                  {currentDetail.renewable
                    ? currentDetail.route?.steps.some((s) => s.loop)
                      ? "Renewable via a recycling loop · reserve the starting stock"
                      : "Renewable with the sources and setup below"
                    : "No fully renewable route proven yet"}
                </p>
                {currentDetail.route ? (
                  <Route route={currentDetail.route} detail={currentDetail} onSelect={select} />
                ) : (
                  <>
                    <p className="mb-5 text-sm leading-6 text-fg-muted">
                      These candidate recipes still need external inputs or a review of machine
                      behavior. Treat those inputs as ongoing supplies until their renewable sources
                      are established.
                    </p>
                    {currentDetail.candidates.map((candidate, index) => (
                      <details
                        key={index}
                        open={index === 0}
                        className="mb-4 rounded-lg border border-line p-4"
                      >
                        <summary className="cursor-pointer text-sm font-medium">
                          Candidate {index + 1} · {candidate.external.length} external inputs
                        </summary>
                        <div className="mt-4">
                          <Route route={candidate} detail={currentDetail} onSelect={select} />
                        </div>
                      </details>
                    ))}
                    <p className="text-xs text-fg-subtle">
                      {currentDetail.candidateCount
                        ? `Showing up to 3 of ${number(currentDetail.candidateCount)} normalized producing recipes. These are candidates, not proofs of renewability.`
                        : "No producing recipe is covered by the current adapters. World interactions and other recipe types may provide this resource."}
                    </p>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-fg-subtle">{label}</p>
    </div>
  );
}

function Route({
  route,
  detail,
  onSelect,
}: {
  route: GuideRoute;
  detail: GuideDetail;
  onSelect: (key: string) => void;
}) {
  const [showSupplies, setShowSupplies] = useState(false);
  const compact = route.steps.length > 12;
  const mainSteps = new Set(
    route.steps.flatMap((step, index) =>
      step.loop || index >= route.steps.length - 3 ? [index] : [],
    ),
  );
  const hiddenCount = compact ? route.steps.length - mainSteps.size : 0;
  const label = (key: string) => detail.resources[key]?.displayName ?? key;
  const resourceButton = (key: string) => (
    <button
      onClick={() => onSelect(key)}
      className="text-left text-emerald-300 underline decoration-emerald-800 underline-offset-2 hover:text-emerald-200"
    >
      {label(key)}
    </button>
  );
  return (
    <div className="space-y-6">
      {route.external.length > 0 && (
        <div className="rounded-lg border border-amber-900 bg-amber-950/20 p-4">
          <h3 className="mb-2 text-sm font-semibold text-amber-300">
            External inputs · replenishment not proven
          </h3>
          <ul className="space-y-1 text-sm">
            {route.external.map((key) => (
              <li key={key}>{resourceButton(key)}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-5 text-fg-muted">
            Mining these supplies does not make the line renewable. Some may have routes that the
            current audit has not covered.
          </p>
        </div>
      )}
      {route.sources.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold">Start with renewable sources</h3>
          <div className="space-y-3">
            {route.sources.map((source) => (
              <article key={source.id} className="rounded-lg border border-line bg-canvas p-4">
                <h4 className="mb-2 text-sm font-semibold text-emerald-300">{source.title}</h4>
                <p className="text-sm leading-6 text-fg-muted">{source.description}</p>
                <p className="mt-3 text-xs leading-5">
                  <span className="font-semibold">One-time setup: </span>
                  {source.startup.join(" · ")}
                </p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                  {source.evidence.map((e) => (
                    <a
                      key={e.url}
                      href={e.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-fg-subtle underline"
                    >
                      {e.title}
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      {route.steps.length > 0 && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Production sequence</h3>
            <span className="text-xs text-fg-subtle">
              Base recipe voltage up to {tiers[route.voltage] ?? route.voltage} · see setup
              requirements
            </span>
          </div>
          {hiddenCount > 0 && (
            <div className="mb-4 rounded-lg border border-line p-3 text-xs leading-6 text-fg-muted">
              <p>
                The complete route includes {number(route.steps.length)} recipe steps. The
                production end and any recycling batches are shown below; their upstream supplies
                have also been checked.
              </p>
              <button
                onClick={() => setShowSupplies(!showSupplies)}
                aria-expanded={showSupplies}
                className="mt-2 font-semibold text-emerald-300 underline underline-offset-2"
              >
                {showSupplies
                  ? "Collapse upstream supply steps"
                  : `Show upstream supply (${number(hiddenCount)} more steps)`}
              </button>
            </div>
          )}
          <ol className="space-y-3">
            {route.steps.map(
              (step, index) =>
                (!compact || showSupplies || mainSteps.has(index)) && (
                  <li key={step.id} className="rounded-lg border border-line bg-canvas p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-raised text-xs text-fg-muted">
                        {index + 1}
                      </span>
                      <h4 className="text-sm font-semibold">
                        {step.loop
                          ? "Recycling loop"
                          : recipeMapLabel(step.machine)
                              .replace(/^minecraft:/, "")
                              .replace(/_/g, " ")}
                      </h4>
                    </div>
                    {!step.reviewed && (
                      <p className="mb-3 text-xs text-amber-300">
                        Machine behavior needs review. This step is not a renewable-production
                        proof.
                      </p>
                    )}
                    <div className="grid gap-3 text-sm sm:grid-cols-[1fr_auto_1fr]">
                      <div>
                        <p className="mb-2 text-xs text-fg-subtle">
                          {step.loop ? "Net supply per complete batch" : "Consumed each recipe"}
                        </p>
                        {step.inputs
                          .filter((i) => i.consumed)
                          .map((input, i) => (
                            <p key={i} className="mb-1 leading-6">
                              {input.choices[0] !== "utility:renewable_electricity" && (
                                <>
                                  {number(input.amount)}
                                  {input.choices[0].startsWith("fluid:") ? " mB" : ""} ×{" "}
                                </>
                              )}
                              {resourceButton(step.selectedInputs?.[i] ?? input.choices[0])}
                              {input.choices.length > 1 && (
                                <span className="text-xs text-fg-subtle">
                                  {" "}
                                  (one of {input.choices.length} alternatives)
                                </span>
                              )}
                            </p>
                          ))}
                        {!step.inputs.some((i) => i.consumed) && (
                          <p className="text-fg-muted">No consumed materials</p>
                        )}
                      </div>
                      <ArrowRight className="mt-6 hidden h-4 w-4 text-fg-subtle sm:block" />
                      <div>
                        <p className="mb-2 text-xs text-fg-subtle">
                          Produced · after guaranteed returns
                        </p>
                        {step.outputs
                          .filter((o) => o.amount > 0 && o.chance > 0)
                          .map((output, i) => (
                            <p key={i} className="mb-1 leading-6">
                              {number(output.amount)}
                              {output.key.startsWith("fluid:") ? " mB" : ""} ×{" "}
                              {resourceButton(output.key)}
                              {output.chance < 1 && (
                                <span className="text-xs text-amber-300">
                                  {" "}
                                  ({number(output.chance * 100)}% chance)
                                </span>
                              )}
                            </p>
                          ))}
                      </div>
                    </div>
                    {(step.startup.length > 0 || step.circuit !== undefined) && (
                      <div className="mt-3 border-t border-line pt-3 text-xs leading-6">
                        <span className="font-semibold text-fg-muted">
                          Reusable startup inventory:{" "}
                        </span>
                        {step.startup.map((input, i) => (
                          <span key={i}>
                            {i > 0 ? " · " : ""}
                            {number(input.amount)} × {label(input.choices[0])}
                            {input.returned ? " (returned)" : " (not consumed)"}
                          </span>
                        ))}
                        {step.circuit !== undefined && (
                          <span>
                            {step.startup.length ? " · " : ""}Circuit configuration {step.circuit}
                          </span>
                        )}
                      </div>
                    )}
                    {step.conditions.map((c, i) => (
                      <p key={i} className="mt-2 break-words text-xs leading-5 text-amber-200">
                        {conditionText(c)}
                      </p>
                    ))}
                    {Object.keys(step.data ?? {}).length > 0 && (
                      <p className="mt-2 break-words text-xs leading-5 text-amber-200">
                        Recipe requirements:{" "}
                        {Object.entries(step.data!)
                          .map(([k, v]) => `${k.replace(/_/g, " ")} = ${JSON.stringify(v)}`)
                          .join(" · ")}
                      </p>
                    )}
                    {step.notes.map((note) => (
                      <p key={note} className="mt-2 text-xs leading-5 text-fg-muted">
                        {note}
                      </p>
                    ))}
                    {step.loop && <CycleSteps recipe={step} resources={detail.resources} />}
                    <details className="mt-3 text-xs text-fg-subtle">
                      <summary className="cursor-pointer">Recipe reference</summary>
                      <p className="mt-2 break-all">{step.id}</p>
                      {step.eut && (
                        <p className="mt-1">
                          {step.eut} EU/t · {step.durationTicks} base ticks. Actual machine speed is
                          not calculated here.
                        </p>
                      )}
                    </details>
                  </li>
                ),
            )}
          </ol>
        </div>
      )}
      <div className="rounded-lg border border-line p-4 text-xs leading-6 text-fg-muted">
        <span className="font-semibold text-fg">Keep the line running: </span>Automate input and
        output transfers, keep the area loaded, and buffer or remove every byproduct. Use full-auto
        maintenance on multiblocks that require it. Build the listed machines and reusable inventory
        once; consumable shortages or blocked outputs will stop production.
      </div>
    </div>
  );
}

function CycleSteps({
  recipe,
  resources,
}: {
  recipe: GuideRecipe;
  resources: Record<string, GuideResource>;
}) {
  const label = (key: string) => resources[key]?.displayName ?? key;
  return (
    <details open className="mt-4 rounded-lg border border-amber-800/60 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-amber-200">
        Repeat this complete batch · {recipe.loop!.steps.reduce((s, r) => s + r.count, 0)} recipe
        runs
      </summary>
      <p className="my-3 text-xs leading-5 text-fg-muted">
        The order below restores the starting stock. Keep that inventory in the loop and export only
        the net surplus. Reusable molds, circuits and machine requirements are in each step. Inputs
        and outputs below are totals for this batch.
      </p>
      <ol className="space-y-3">
        {recipe.loop!.steps.map((s, index) => {
          const member = s.recipe!;
          return (
            <li
              key={`${s.recipeId}:${index}`}
              className="rounded border border-line bg-surface p-3"
            >
              <h5 className="mb-2 text-sm font-semibold">
                {index + 1}. {recipeMapLabel(member.machine)} · {number(s.count)}{" "}
                {s.count === 1 ? "run" : "runs"}
              </h5>
              <div className="grid gap-3 text-xs leading-6 sm:grid-cols-2">
                <div>
                  <p className="font-semibold text-fg-muted">Supply</p>
                  {member.inputs
                    .filter((i) => i.consumed)
                    .map((input, i) => (
                      <p key={i}>
                        {s.selectedInputs[i] !== "utility:renewable_electricity" && (
                          <>
                            {number(input.amount * s.count)}
                            {s.selectedInputs[i].startsWith("fluid:") ? " mB" : ""} ×{" "}
                          </>
                        )}
                        {label(s.selectedInputs[i])}
                      </p>
                    ))}
                </div>
                <div>
                  <p className="font-semibold text-fg-muted">Guaranteed production</p>
                  {member.outputs
                    .filter((o) => o.chance === 1 && o.amount > 0)
                    .map((o, i) => (
                      <p key={i}>
                        {number(o.amount * s.count)}
                        {o.key.startsWith("fluid:") ? " mB" : ""} × {label(o.key)}
                      </p>
                    ))}
                </div>
              </div>
              {member.startup.length > 0 && (
                <p className="mt-2 text-xs leading-6 text-fg-muted">
                  Reusable:{" "}
                  {member.startup
                    .map((i) => `${number(i.amount)} × ${label(i.choices[0])}`)
                    .join(" · ")}
                </p>
              )}
              {member.circuit !== undefined && (
                <p className="text-xs leading-6 text-fg-muted">
                  Circuit configuration {member.circuit}
                </p>
              )}
              {member.conditions.map((c, i) => (
                <p key={i} className="text-xs leading-5 text-amber-200">
                  {conditionText(c)}
                </p>
              ))}
              {Object.keys(member.data ?? {}).length > 0 && (
                <p className="break-words text-xs leading-5 text-amber-200">
                  Requirements: {JSON.stringify(member.data)}
                </p>
              )}
              {member.notes.map((note) => (
                <p key={note} className="mt-2 text-xs leading-5 text-fg-muted">
                  {note}
                </p>
              ))}
              <p className="mt-2 break-all text-[10px] text-fg-subtle">{s.recipeId}</p>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
