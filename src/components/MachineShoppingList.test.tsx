// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { factoryProjectSchema } from "@/lib/model/schemas";
import { useFactoryStore } from "@/store/factory-store";
import { MachineShoppingList } from "./MachineShoppingList";
import { getHandlerRecipeStats } from "./flow/MachinePicker";

afterEach(cleanup);

it("lists whole Monifactory machines and solved average power for a net fuel chain", () => {
  const project = factoryProjectSchema.parse(JSON.parse(readFileSync(
    "public/examples/monifactory-ethanol-power.json", "utf8",
  )));
  useFactoryStore.getState().setProject(project);
  const generator = project.recipes.find((r) => r.id === "gtceu:combustion_generator/ethanol")!;
  expect(generator.machineHandlers!.map((handler) => getHandlerRecipeStats(generator, handler).outputEUt))
    .toEqual([32, 128, 512]);
  const { container } = render(<MachineShoppingList />);
  expect(screen.getByRole("button", { name: /27×\s*Greenhouse/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /214×\s*Basic Brewery/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /2×\s*Advanced Distillery/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /96×\s*LV Combustion Generator/ })).toBeTruthy();
  const net = screen.getByText("Net").parentElement!;
  expect(net.textContent).toContain("+70");
  expect(net.textContent).toContain("+128");
  expect(container.textContent).not.toContain("-151");
});
