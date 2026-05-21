import { clickByTestId } from "./util.ts";
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Return the integration step locators in execution order from top to bottom.
 */
export function getBranchIntegrationSteps(page: Page): Locator {
	return page.getByTestId("branch-integration-step");
}

/**
 * Append a new integration step and verify the step count increased by one.
 */
export async function addBranchIntegrationStep(page: Page): Promise<void> {
	const steps = getBranchIntegrationSteps(page);
	const stepCountBefore = await steps.count();
	await clickByTestId(page, "branch-integration-add-step-button");
	await expect(steps).toHaveCount(stepCountBefore + 1);
}

/**
 * Delete the integration step at the provided zero-based index.
 */
export async function deleteBranchIntegrationStep(page: Page, index: number): Promise<void> {
	const steps = getBranchIntegrationSteps(page);
	const stepCountBefore = await steps.count();
	const step = steps.nth(index);
	await step.getByRole("button", { name: "Delete" }).click();
	await expect(steps).toHaveCount(stepCountBefore - 1);
}

/**
 * Change the kind of the integration step at the provided zero-based index.
 */
export async function setBranchIntegrationStepKind(
	page: Page,
	index: number,
	kind: "pick" | "merge" | "squash",
): Promise<void> {
	const step = getBranchIntegrationSteps(page).nth(index);
	const kindSelect = step.locator("select").first();
	await kindSelect.selectOption(kind);
	await expect(step).toHaveAttribute("data-branch-integration-step-kind", kind);
}

/**
 * Select a commit for the integration step at the provided zero-based index.
 *
 * The commit is matched by a unique title substring in the visible option text.
 */
export async function setBranchIntegrationStepCommitByTitle(
	page: Page,
	index: number,
	commitTitle: string,
): Promise<void> {
	const step = getBranchIntegrationSteps(page).nth(index);
	const commitSelect = step.locator("select").nth(1);
	const options = await commitSelect.locator("option").evaluateAll((nodes) =>
		nodes.map((node) => ({
			value: node.getAttribute("value") ?? "",
			text: node.textContent?.trim() ?? "",
		})),
	);

	const matches = options.filter((option) => option.text.includes(commitTitle));
	if (matches.length !== 1) {
		throw new Error(
			`Expected exactly one integration commit option containing "${commitTitle}", got ${matches.length}: ${matches
				.map((option) => option.text)
				.join(" | ")}`,
		);
	}

	const [match] = matches;
	if (!match) throw new Error(`No integration commit option matched "${commitTitle}"`);
	await commitSelect.selectOption(match.value);
	await expect(commitSelect.locator("option:checked")).toContainText(commitTitle);
}

/**
 * Run the branch integration preview and wait for the preview commit rows to appear.
 */
export async function previewBranchIntegration(page: Page): Promise<void> {
	await clickByTestId(page, "branch-integration-preview-button");
	const previewRows = page.locator(
		'[data-testid="branch-integration-preview-row"][data-branch-integration-row-kind="integrated"]',
	);
	await expect(previewRows.first()).toBeVisible();
	await expect(page.getByTestId("branch-integration-error")).toHaveCount(0);
}

/**
 * Return preview commit titles in child-to-parent order from top to bottom.
 */
export async function getBranchIntegrationPreviewCommitTitles(page: Page): Promise<string[]> {
	return await page
		.locator('[data-testid="branch-integration-preview-row"][data-branch-integration-row-kind="integrated"]')
		.evaluateAll((nodes) =>
			nodes
				.map((node) => node.getAttribute("data-branch-integration-row-subject") ?? "")
				.filter((title) => title !== ""),
		);
}

/**
 * Apply the currently configured branch integration plan and wait for the modal to close.
 */
export async function applyBranchIntegration(page: Page): Promise<void> {
	await clickByTestId(page, "branch-integration-apply-button");
	await expect(page.getByTestId("branch-integration-modal")).toHaveCount(0);
}

/**
 * Return workspace commit titles in child-to-parent order from top to bottom.
 *
 * When `branchName` is provided, the titles are read only from the matching stack.
 */
export async function getWorkspaceCommitTitles(page: Page, branchName?: string): Promise<string[]> {
	const scope = branchName
		? page
				.getByTestId("stack")
				.filter({ has: page.getByTestId("branch-header").filter({ hasText: branchName }) })
		: page;

	return await scope
		.getByTestId("commit-row")
		.locator("h3")
		.evaluateAll((nodes) =>
			nodes.map((node) => node.textContent?.trim() ?? "").filter((title) => title !== ""),
		);
}
