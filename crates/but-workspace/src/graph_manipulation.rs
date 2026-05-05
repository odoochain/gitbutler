//! Shared graph editor traversal and edge-manipulation helpers.

use anyhow::{Result, bail};
use but_core::RefMetadata;
use but_rebase::graph_rebase::{
    Editor, Selector, Step, ToSelector,
    mutate::{SegmentDelimiter, SelectorSet},
};
use std::collections::HashSet;

/// Which direct edge set to resolve from a selector.
#[derive(Clone, Copy)]
pub(crate) enum EdgeSelection {
    /// Resolve direct child edges.
    Children,
    /// Resolve direct parent edges.
    Parents,
}

/// Disconnect all parent edges from a single selector without reconnecting them.
///
/// `editor` is the mutable graph editor whose connectivity will be updated.
///
/// `selector` is the node whose parent edges should be removed.
///
/// Returns `Ok(())` after all direct parent edges of `selector` have been
/// removed from the editor graph.
pub(crate) fn disconnect_selector_from_all_parents<M: RefMetadata>(
    editor: &mut Editor<'_, '_, M>,
    selector: Selector,
) -> Result<()> {
    editor.disconnect_segment_from(
        SegmentDelimiter {
            child: selector,
            parent: selector,
        },
        SelectorSet::None,
        SelectorSet::All,
        true,
    )?;

    Ok(())
}

/// Resolve concrete direct edges selected by a selector set, preserving edge order.
///
/// `editor` provides the direct parent or child edges that can be selected.
///
/// `target` is the node whose adjacent edges should be filtered.
///
/// `selectors` describes which neighboring selectors to keep, or whether to
/// keep all or none of them.
///
/// `edge_selection` chooses whether neighbors are read from direct children or
/// direct parents of `target`.
///
/// Returns the selected neighboring selectors paired with their existing edge
/// order values.
pub(crate) fn selected_edges_from_set<M: RefMetadata>(
    editor: &Editor<'_, '_, M>,
    target: Selector,
    selectors: &SelectorSet,
    edge_selection: EdgeSelection,
) -> Result<Vec<(Selector, usize)>> {
    let available = match edge_selection {
        EdgeSelection::Children => editor.direct_children(target)?,
        EdgeSelection::Parents => editor.direct_parents(target)?,
    };

    match selectors {
        SelectorSet::All => Ok(available),
        SelectorSet::None => Ok(Vec::new()),
        SelectorSet::Some(some_selectors) => {
            let mut selected = Vec::new();
            for selector in some_selectors.as_slice() {
                let selector = selector.to_selector(editor)?;
                let Some((_, order)) = available
                    .iter()
                    .find(|(candidate, _)| *candidate == selector)
                else {
                    bail!("Selected edge endpoint wasn't found among direct neighbors")
                };
                selected.push((selector, *order));
            }
            Ok(selected)
        }
    }
}

/// Reconnect a rebuilt segment to previously selected children and parents.
///
/// `editor` is the mutable graph editor whose edges will be recreated.
///
/// `delimiter` identifies the rebuilt segment's child-most and parent-most
/// selectors.
///
/// `children` are the previously captured child edges that should point back to
/// `delimiter.child` with their original order.
///
/// `parents` are the previously captured parent edges that should be restored
/// from `delimiter.parent`, with fresh order values appended after any existing
/// parents already connected there.
///
/// Returns `Ok(())` after the captured child and parent edges have been
/// reattached to the rebuilt segment.
pub(crate) fn connect_segment_to_edges<M: RefMetadata>(
    editor: &mut Editor<'_, '_, M>,
    delimiter: SegmentDelimiter<Selector, Selector>,
    children: &[(Selector, usize)],
    parents: &[(Selector, usize)],
) -> Result<()> {
    for (child, order) in children {
        editor.add_edge(*child, delimiter.child, *order)?;
    }

    let max_parent_weight = editor
        .direct_parents(delimiter.parent)?
        .into_iter()
        .map(|(_, order)| order)
        .max()
        .unwrap_or(0);

    for (parent, order) in parents {
        let next_order = max_parent_weight + *order + 1;
        editor.add_edge(delimiter.parent, *parent, next_order)?;
    }

    Ok(())
}

/// Return a direct parent of `child` when `step` refers to a pick that is already connected.
///
/// This is useful when rebuilding an editor segment and we want to reuse an existing
/// pick node without adding a duplicate edge to the same commit.
///
/// `editor` provides access to the current parent edges and commit selectors.
///
/// `child` is the node whose direct parents should be inspected.
///
/// `step` is the candidate step whose pick commit should be matched against the
/// already-connected parents of `child`.
///
/// Returns the matching direct parent selector when `step` already corresponds
/// to an attached pick parent, or `None` otherwise.
pub(crate) fn already_connected_parent_for_step<M: RefMetadata>(
    editor: &Editor<'_, '_, M>,
    child: Selector,
    step: &Step,
) -> Result<Option<Selector>> {
    let Step::Pick(pick) = step else {
        return Ok(None);
    };

    let Some(existing_pick) = editor.try_select_commit(pick.id) else {
        return Ok(None);
    };

    let direct_parents = editor.direct_parents(child)?;
    Ok(direct_parents
        .into_iter()
        .find_map(|(parent, _)| (parent == existing_pick).then_some(parent)))
}

/// Connect `child` to `parent_step`, reusing an existing pick node when possible.
///
/// The new edge gets the smallest currently unused parent order on `child`, which keeps
/// parent ordering stable while allowing callers to splice additional parents into a node.
///
/// `editor` is the mutable graph editor that may reuse an existing pick or add a
/// new step before creating the edge.
///
/// `child` is the selector that should gain a new direct parent.
///
/// `parent_step` describes the parent node to connect, either by reusing an
/// existing pick/reference selector or by inserting a new pick step first.
///
/// Returns the selector of the connected parent node.
pub(crate) fn connect_parent_step<M: RefMetadata>(
    editor: &mut Editor<'_, '_, M>,
    child: Selector,
    parent_step: Step,
) -> Result<Selector> {
    let parent = match parent_step {
        Step::Pick(pick) => {
            if let Some(existing_pick) = editor.try_select_commit(pick.id) {
                existing_pick
            } else {
                editor.add_step(Step::Pick(pick))?
            }
        }
        Step::Reference { ref refname } => editor.select_reference(refname.as_ref())?,
        Step::None => bail!("BUG: trying to connect to none"),
    };

    let used_orders = editor
        .direct_parents(child)?
        .into_iter()
        .map(|(_, order)| order)
        .collect::<HashSet<_>>();
    let mut order = 0;
    while used_orders.contains(&order) {
        order += 1;
    }

    editor.add_edge(child, parent, order)?;
    Ok(parent)
}

/// Find all parent-reachable nodes from and including the provided tip.
///
/// `editor` provides the parent-edge traversal used for the walk.
///
/// `tip` is the starting selector whose ancestors should be collected.
///
/// Returns the set containing `tip` and every selector reachable from it by
/// repeatedly following direct parent edges.
pub(crate) fn traverse_nodes<M: RefMetadata>(
    editor: &Editor<'_, '_, M>,
    tip: Selector,
) -> Result<HashSet<Selector>> {
    let mut seen = HashSet::from([tip]);
    let mut tips = vec![tip];

    while let Some(tip) = tips.pop() {
        for (parent, _) in editor.direct_parents(tip)? {
            if seen.insert(parent) {
                tips.push(parent);
            }
        }
    }

    Ok(seen)
}
