<script lang="ts">
	import ReduxResult from "$components/shared/ReduxResult.svelte";
	import { STACK_SERVICE } from "$lib/stacks/stackService.svelte";
	import {
		buildCommitPickerOptions,
		buildIntegrationStepDrafts,
		buildInteractiveIntegration,
		changeIntegrationStepDraftKind,
		createDefaultIntegrationStepDraft,
		type CommitPickerOption,
		type IntegrationStepDraft,
		reorderIntegrationStepDrafts,
		updateIntegrationStepDraftCommit,
		updateIntegrationStepDraftMessage,
	} from "$lib/upstream/branchIntegrationEditor";
	import {
		buildCurrentStateGraphRows,
		buildNextStateGraphRows,
		type IntegrationGraphRow,
	} from "$lib/upstream/branchIntegrationView";
	import { inject } from "@gitbutler/core/context";
	import { Button, Modal, ModalFooter, SegmentControl } from "@gitbutler/ui";
	import type { BranchIntegrationStrategy } from "@gitbutler/but-sdk";

	type Props = {
		modalRef: Modal | undefined;
		projectId: string;
		branchName: string;
		branchRef: string;
	};

	let { modalRef = $bindable(), projectId, branchName, branchRef }: Props = $props();

	const stackService = inject(STACK_SERVICE);
	const DEFAULT_TEMPLATE: BranchIntegrationStrategy = "pullRebase";
	const integrationTemplates: Array<{ id: BranchIntegrationStrategy; label: string }> = [
		{ id: "pullRebase", label: "Pull rebase" },
		{ id: "merge", label: "Merge" },
		{ id: "resetToRemote", label: "Reset to remote" },
	];
	let selectedTemplate = $state<BranchIntegrationStrategy>(DEFAULT_TEMPLATE);
	const initialBranchIntegration = $derived(
		stackService.initialBranchIntegration(projectId, branchRef, selectedTemplate),
	);
	const [applyBranchIntegration, integrationMutation] = stackService.applyBranchIntegration;

	let stepDrafts = $state<IntegrationStepDraft[]>([]);
	let previewRows = $state<IntegrationGraphRow[] | null>(null);
	let previewError = $state<string | null>(null);
	let previewEmpty = $state(true);
	let activeAction = $state<"preview" | "apply" | null>(null);
	let initializedForOpen = $state(false);
	let templateSelectionVersion = 0;

	function displayCommitOption(option: CommitPickerOption): string {
		const refs = option.refs.length === 0 ? "" : ` (${option.refs.join(", ")})`;
		return `${option.id.slice(0, 7)}${refs} ${option.subject}`;
	}

	function closeModal() {
		modalRef?.close();
	}

	function formatError(error: unknown): string {
		return error instanceof Error ? error.message : JSON.stringify(error);
	}

	function moveStep(stepId: string, offset: -1 | 1) {
		const sourceIndex = stepDrafts.findIndex((step) => step.id === stepId);
		if (sourceIndex === -1) return;
		const destinationIndex = sourceIndex + offset;
		if (destinationIndex < 0 || destinationIndex > stepDrafts.length) return;
		stepDrafts = reorderIntegrationStepDrafts({
			steps: stepDrafts,
			draggedStepId: stepId,
			destinationIndex,
		});
	}

	function deleteStep(stepId: string) {
		stepDrafts = stepDrafts.filter((step) => step.id !== stepId);
	}

	async function previewIntegrationWithSteps(
		mergeBase: string,
		steps: IntegrationStepDraft[],
		expectedTemplateSelectionVersion: number | undefined = undefined,
	) {
		activeAction = "preview";
		previewError = null;
		try {
			const integration = buildInteractiveIntegration({ mergeBase, steps });
			const result = await applyBranchIntegration({
				projectId,
				branchRef,
				integration,
				dryRun: true,
			});
			const nextPreviewRows = buildNextStateGraphRows({
				workspace: result.workspace,
				branchRef,
			});
			if (
				expectedTemplateSelectionVersion !== undefined &&
				expectedTemplateSelectionVersion !== templateSelectionVersion
			) {
				return;
			}
			previewRows = nextPreviewRows;
			previewEmpty = false;
		} catch (error) {
			if (
				expectedTemplateSelectionVersion !== undefined &&
				expectedTemplateSelectionVersion !== templateSelectionVersion
			) {
				return;
			}
			previewRows = null;
			previewError = formatError(error);
			previewEmpty = false;
		} finally {
			if (
				expectedTemplateSelectionVersion === undefined ||
				expectedTemplateSelectionVersion === templateSelectionVersion
			) {
				activeAction = null;
			}
		}
	}

	async function previewIntegration(mergeBase: string) {
		await previewIntegrationWithSteps(mergeBase, stepDrafts);
	}

	async function selectTemplate(template: BranchIntegrationStrategy) {
		if (template === selectedTemplate) return;

		selectedTemplate = template;
		const version = ++templateSelectionVersion;
		previewRows = null;
		previewError = null;
		previewEmpty = true;

		try {
			const initial = await stackService.fetchInitialBranchIntegration(
				projectId,
				branchRef,
				template,
			);
			if (version !== templateSelectionVersion) return;

			const nextStepDrafts = buildIntegrationStepDrafts(initial.integration);
			stepDrafts = nextStepDrafts;
			if (nextStepDrafts.length > 0) {
				await previewIntegrationWithSteps(initial.integration.mergeBase, nextStepDrafts, version);
			}
		} catch (error) {
			if (version !== templateSelectionVersion) return;
			previewRows = null;
			previewError = formatError(error);
			previewEmpty = false;
		}
	}

	async function applyIntegration(mergeBase: string) {
		activeAction = "apply";
		previewError = null;
		try {
			const integration = buildInteractiveIntegration({ mergeBase, steps: stepDrafts });
			await applyBranchIntegration({
				projectId,
				branchRef,
				integration,
				dryRun: false,
			});
			closeModal();
		} catch (error) {
			previewError = formatError(error);
		} finally {
			activeAction = null;
		}
	}

	$effect(() => {
		const modalOpen = modalRef?.imports.open ?? false;
		if (!modalOpen) {
			selectedTemplate = DEFAULT_TEMPLATE;
			templateSelectionVersion++;
			initializedForOpen = false;
			previewRows = null;
			previewError = null;
			previewEmpty = true;
		}
	});

	$effect(() => {
		const modalOpen = modalRef?.imports.open ?? false;
		const initial = initialBranchIntegration.response;
		if (!modalOpen || !initial || initializedForOpen) return;

		stepDrafts = buildIntegrationStepDrafts(initial.integration);
		previewRows = null;
		previewError = null;
		previewEmpty = true;
		initializedForOpen = true;
	});
</script>

<Modal
	bind:this={modalRef}
	title={`Integrate ${branchName} upstream`}
	noPadding
	width="full-screen"
	testId="branch-integration-modal"
>
	<ReduxResult {projectId} result={initialBranchIntegration.result}>
		{#snippet children(initialIntegration)}
			{@const commitOptions = buildCommitPickerOptions(initialIntegration)}
			{@const currentRows = buildCurrentStateGraphRows(initialIntegration)}
			<div class="branch-integration">
				<div class="branch-integration__intro">
					<p class="text-13">
						Review the current divergence, edit the integration steps, and preview the result before
						applying it.
					</p>
				</div>

				<div class="branch-integration__sections">
					<section
						class="branch-integration__section"
						data-testid="branch-integration-current-state"
					>
						<div class="branch-integration__section-header">
							<h3 class="text-13 text-semibold">Current state</h3>
						</div>
						<div class="branch-integration__graph">
							{#each currentRows as row, index (`current-${index}`)}
								{@render graphRow(row, "branch-integration-current-state-row")}
							{/each}
						</div>
					</section>

					<section class="branch-integration__section" data-testid="branch-integration-steps">
						<div class="branch-integration__section-header">
							<h3 class="text-13 text-semibold">Integration steps</h3>
							<div class="branch-integration__section-actions">
								<SegmentControl
									size="small"
									selected={selectedTemplate}
									onselect={(id) => selectTemplate(id as BranchIntegrationStrategy)}
								>
									{#each integrationTemplates as template (template.id)}
										<SegmentControl.Item
											id={template.id}
											testId={`branch-integration-template-${template.id}`}
										>
											{template.label}
										</SegmentControl.Item>
									{/each}
								</SegmentControl>
								<Button
									kind="outline"
									size="tag"
									icon="plus"
									testId="branch-integration-add-step-button"
									disabled={commitOptions.length === 0}
									onclick={() =>
										(stepDrafts = [
											...stepDrafts,
											createDefaultIntegrationStepDraft(commitOptions),
										])}
								>
									Add step
								</Button>
							</div>
						</div>
						<div class="branch-integration__steps">
							{#if stepDrafts.length === 0}
								<div class="branch-integration__empty">
									No integration steps yet. Add a step to build the plan.
								</div>
							{:else}
								{#each stepDrafts as step, index (step.id)}
									<div
										class="branch-integration__step"
										data-testid="branch-integration-step"
										data-branch-integration-step-kind={step.kind}
										data-branch-integration-step-index={index}
									>
										<div class="branch-integration__step-toolbar">
											<span class="text-11 clr-text-2">Step {index + 1}</span>
											<div class="branch-integration__step-actions">
												<Button
													kind="outline"
													size="tag"
													icon="arrow-up"
													disabled={index === 0}
													onclick={() => moveStep(step.id, -1)}
												/>
												<Button
													kind="outline"
													size="tag"
													icon="arrow-down"
													disabled={index === stepDrafts.length - 1}
													onclick={() => moveStep(step.id, 1)}
												/>
												<Button kind="outline" size="tag" onclick={() => deleteStep(step.id)}>
													Delete
												</Button>
											</div>
										</div>

										<div class="branch-integration__step-fields">
											<label class="branch-integration__field">
												<select
													value={step.kind}
													onchange={(event) =>
														(stepDrafts = stepDrafts.map((candidate) =>
															candidate.id === step.id
																? changeIntegrationStepDraftKind({
																		step: candidate,
																		kind: event.currentTarget.value as IntegrationStepDraft["kind"],
																		commitOptions,
																	})
																: candidate,
														))}
												>
													<option value="pick">Pick</option>
													<option value="merge">Merge</option>
													<option value="squash">Squash</option>
												</select>
											</label>

											{#if step.kind === "squash"}
												<label class="branch-integration__field">
													<select
														value={step.commitIds[0]}
														onchange={(event) =>
															(stepDrafts = stepDrafts.map((candidate) =>
																candidate.id === step.id
																	? updateIntegrationStepDraftCommit({
																			step: candidate,
																			commitId: event.currentTarget.value,
																			index: 0,
																			commitOptions,
																		})
																	: candidate,
															))}
													>
														{@render commitOptionsMarkup(commitOptions)}
													</select>
												</label>
												<label class="branch-integration__field">
													<select
														value={step.commitIds[1]}
														onchange={(event) =>
															(stepDrafts = stepDrafts.map((candidate) =>
																candidate.id === step.id
																	? updateIntegrationStepDraftCommit({
																			step: candidate,
																			commitId: event.currentTarget.value,
																			index: 1,
																			commitOptions,
																		})
																	: candidate,
															))}
													>
														{@render commitOptionsMarkup(commitOptions, step.commitIds[0])}
													</select>
												</label>
												<label class="branch-integration__field branch-integration__field--full">
													<textarea
														rows="3"
														value={step.message}
														oninput={(event) =>
															(stepDrafts = stepDrafts.map((candidate) =>
																candidate.id === step.id
																	? updateIntegrationStepDraftMessage({
																			step: candidate,
																			message: event.currentTarget.value,
																		})
																	: candidate,
															))}
													></textarea>
												</label>
											{:else}
												<label class="branch-integration__field branch-integration__field--full">
													<select
														value={step.commitId}
														onchange={(event) =>
															(stepDrafts = stepDrafts.map((candidate) =>
																candidate.id === step.id
																	? updateIntegrationStepDraftCommit({
																			step: candidate,
																			commitId: event.currentTarget.value,
																			commitOptions,
																		})
																	: candidate,
															))}
													>
														{@render commitOptionsMarkup(commitOptions)}
													</select>
												</label>
											{/if}
										</div>
									</div>
								{/each}
							{/if}
						</div>
					</section>

					<section class="branch-integration__section" data-testid="branch-integration-preview">
						<div class="branch-integration__section-header">
							<h3 class="text-13 text-semibold">Preview</h3>
						</div>
						<div class="branch-integration__graph">
							{#if previewEmpty}
								<div class="branch-integration__empty" data-testid="branch-integration-empty-state">
									Run preview to inspect the resulting branch shape.
								</div>
							{:else if previewError}
								<div class="branch-integration__error" data-testid="branch-integration-error">
									{previewError}
								</div>
							{:else if previewRows === null}
								<div class="branch-integration__empty" data-testid="branch-integration-empty-state">
									Preview produced no branch segment for this ref.
								</div>
							{:else if previewRows.length === 0}
								<div class="branch-integration__empty" data-testid="branch-integration-empty-state">
									The resulting branch would be empty.
								</div>
							{:else}
								{#each previewRows as row, index (`preview-${index}`)}
									{@render graphRow(row, "branch-integration-preview-row")}
								{/each}
							{/if}
						</div>
					</section>
				</div>
			</div>

			<ModalFooter>
				<Button kind="outline" type="reset" onclick={closeModal}>Cancel</Button>
				<Button
					kind="outline"
					type="button"
					testId="branch-integration-preview-button"
					onclick={() => previewIntegration(initialIntegration.integration.mergeBase)}
					disabled={stepDrafts.length === 0 || integrationMutation.current.isLoading}
					loading={integrationMutation.current.isLoading && activeAction === "preview"}
				>
					Preview
				</Button>
				<Button
					style="pop"
					type="button"
					testId="branch-integration-apply-button"
					onclick={() => applyIntegration(initialIntegration.integration.mergeBase)}
					disabled={stepDrafts.length === 0 || integrationMutation.current.isLoading}
					loading={integrationMutation.current.isLoading && activeAction === "apply"}
				>
					Apply integration
				</Button>
			</ModalFooter>
		{/snippet}
	</ReduxResult>
</Modal>

{#snippet commitOptionsMarkup(
	commitOptions: CommitPickerOption[],
	excludeCommitId: string | undefined = undefined,
)}
	{@const groups = ["Local", "Upstream", "Shared"] as const}
	{@const filteredOptions = commitOptions.filter((option) => option.id !== excludeCommitId)}
	{#each groups as group}
		{@const options = filteredOptions.filter((option) => option.group === group)}
		{#if options.length > 0}
			<optgroup label={group}>
				{#each options as option (option.id)}
					<option value={option.id}>
						{displayCommitOption(option)}
					</option>
				{/each}
			</optgroup>
		{/if}
	{/each}
{/snippet}

{#snippet graphRow(row: IntegrationGraphRow, testId: string)}
	{#if row.kind === "join"}
		<div
			class="branch-integration__graph-row branch-integration__graph-row--join"
			data-testid={testId}
			data-branch-integration-row-kind="join"
		>
			{#if row.leftRail === "|"}
				<div class="branch-integration__graph-rail">
					<div class="branch-integration__graph-vertical-edge"></div>
				</div>
			{/if}
			{#if row.node !== ""}
				<div class="branch-integration__graph-node">
					<span class="branch-integration__graph-rail-text">{row.node}</span>
				</div>
			{/if}
			<div class="branch-integration__graph-rail">
				{#if row.rightRail !== ""}
					<div class="branch-integration__graph-remote-join" aria-hidden="true">
						<div class="branch-integration__graph-remote-join-horizontal"></div>
						<div class="branch-integration__graph-remote-join-vertical"></div>
					</div>
				{/if}
			</div>
			<div></div>
		</div>
	{:else}
		<div
			class="branch-integration__graph-row"
			data-testid={testId}
			data-branch-integration-row-kind={row.commitKind}
			data-branch-integration-row-commit-id={row.content.commitId}
			data-branch-integration-row-subject={row.content.subject}
		>
			{#if row.leftRail === "|"}
				<div
					class={`branch-integration__graph-rail branch-integration__graph-rail--${row.commitKind}`}
				>
					<div
						class={`branch-integration__graph-vertical-edge branch-integration__graph-vertical-edge--${row.commitKind}`}
					></div>
				</div>
			{/if}
			<div
				class={`branch-integration__graph-node branch-integration__graph-node--${row.commitKind}`}
			>
				{#if row.node === "*"}
					<div
						class={`branch-integration__graph-node-dot branch-integration__graph-node-dot--${row.commitKind}`}
					></div>
				{:else if row.node !== ""}
					<span class="branch-integration__graph-rail-text">{row.node}</span>
				{/if}
			</div>
			<div
				class={`branch-integration__graph-rail branch-integration__graph-rail--${row.commitKind}`}
			>
				{#if row.rightRail !== ""}
					<span
						class={`branch-integration__graph-rail-text branch-integration__graph-rail-text--${row.commitKind}`}
					>
						{row.rightRail}
					</span>
				{/if}
			</div>
			<div class="branch-integration__graph-content">
				<div class="branch-integration__graph-subject">{row.content.subject}</div>
				<div class="branch-integration__graph-meta">
					<span>{row.content.commitId.slice(0, 7)}</span>
					{#if row.content.refs.length > 0}
						<span>•</span>
						<span>{row.content.refs.join(", ")}</span>
					{/if}
				</div>
			</div>
		</div>
	{/if}
{/snippet}

<style lang="postcss">
	.branch-integration {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 70vh;
		padding: 0 16px 16px 16px;
		gap: 12px;
	}

	.branch-integration__intro {
		padding-top: 16px;
	}

	.branch-integration__sections {
		display: flex;
		position: relative;
		width: 100%;
		height: 100%;
		gap: 12px;
	}

	.branch-integration__section {
		box-sizing: border-box;
		display: flex;
		flex: 1;
		flex-direction: column;
		width: 100%;
		height: 100%;
		overflow: hidden;
		border: 1px solid var(--border-2);
		border-radius: var(--radius-ml);
		background: var(--bg-1);
	}

	.branch-integration__section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 14px;
		gap: 10px;
		border-bottom: 1px solid var(--border-2);
	}

	.branch-integration__section-actions {
		display: flex;
		align-items: center;
		min-width: 0;
		gap: 8px;
	}

	.branch-integration__graph,
	.branch-integration__steps {
		display: flex;
		flex-direction: column;
	}

	.branch-integration__graph-row {
		display: flex;
		column-gap: 4px;
		align-items: stretch;
		height: 65px;
		padding: 0 14px;
		border-bottom: 1px solid var(--border-2);

		&:last-child {
			border-bottom: none;
		}
	}

	.branch-integration__graph-row--join {
		column-gap: 0;
		align-items: unset;
		gap: 0;
	}

	.branch-integration__graph-rail,
	.branch-integration__graph-node {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 18px;
	}

	.branch-integration__graph-rail {
		/* padding-left: 5px; */
	}

	.branch-integration__graph-rail-text {
		color: var(--text-2);
		font-family: var(--font-mono, monospace);
		white-space: pre;
		&.remote {
			color: var(--hover-pop);
		}
	}

	.branch-integration__graph-vertical-edge {
		width: 2px;
		height: 100%;
		margin-left: 4px;
		background: var(--text-2);
	}

	.branch-integration__graph-remote-join {
		position: relative;
		width: 18px;
		height: 100%;
	}

	.branch-integration__graph-remote-join-horizontal,
	.branch-integration__graph-remote-join-vertical {
		position: absolute;
		background: var(--hover-pop);
	}

	.branch-integration__graph-remote-join-horizontal {
		right: 7px;
		bottom: 7px;
		left: 0;
		height: 2px;
	}

	.branch-integration__graph-remote-join-vertical {
		top: 0;
		right: 7px;
		bottom: 7px;
		width: 2px;
	}

	.branch-integration__graph-node-dot {
		box-sizing: border-box;
		width: 11px;
		height: 11px;
		border: 2px solid var(--text-2);
		border-radius: 999px;
	}

	.branch-integration__graph-node-dot--remote {
		border-color: var(--hover-pop);
	}
	.branch-integration__graph-rail--local,
	.branch-integration__graph-rail--integrated,
	.branch-integration__graph-vertical-edge--local,
	.branch-integration__graph-vertical-edge--remote,
	.branch-integration__graph-vertical-edge--integrated,
	.branch-integration__graph-node--remote,
	.branch-integration__graph-node--integrated,
	.branch-integration__graph-node-dot--remote,
	.branch-integration__graph-node-dot--integrated,
	.branch-integration__graph-rail-text--local,
	.branch-integration__graph-rail-text--remote,
	.branch-integration__graph-rail-text--integrated {
	}

	.branch-integration__graph-content {
		display: flex;
		flex-direction: column;
		justify-content: center;
		min-width: 0;
		gap: 2px;
	}

	.branch-integration__graph-subject {
		overflow: hidden;
		font-weight: 600;
		font-size: 13px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.branch-integration__graph-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		color: var(--text-2);
		font-size: 11px;
	}

	.branch-integration__step {
		display: flex;
		flex-direction: column;
		padding: 12px 14px;
		gap: 10px;
		border-bottom: 1px solid var(--border-2);

		&:last-child {
			border-bottom: none;
		}
	}

	.branch-integration__step-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.branch-integration__step-actions {
		display: flex;
		gap: 4px;
	}

	.branch-integration__step-fields {
		display: flex;
		gap: 10px;
	}

	.branch-integration__field {
		display: flex;
		flex-direction: column;
		gap: 6px;

		& select,
		& textarea {
			width: 100%;
			padding: 8px 10px;
			border: 1px solid var(--border-2);
			border-radius: var(--radius-m);
			background: var(--bg-2);
			color: var(--text-1);
		}
	}

	.branch-integration__field--full {
		grid-column: 1 / -1;
	}

	.branch-integration__empty,
	.branch-integration__error {
		padding: 16px 14px;
		color: var(--text-2);
		font-size: 12px;
	}

	.branch-integration__error {
		color: var(--text-warn);
	}
</style>
