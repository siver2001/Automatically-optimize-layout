import os

file_path = r'c:\Users\long.nh\Desktop\Automatically-optimize-layout\server\algorithms\diecut\strategies\capacity\double-contour\CapacityTestDoubleInsoleDoubleContourPattern.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Normalize content to LF line endings
normalized_content = content.replace('\r\n', '\n')

# 1. Define _alignSplitPlacementWithWholePieces right before _compactSplitFillCandidatePlacement
align_method = """  _alignSplitPlacementWithWholePieces(candidate, orient, occupiedPlacements, config) {
    if (!orient || !candidate) return candidate;
    
    // Only apply to split pieces
    const isSplit = orient.isSplit || orient.foot?.startsWith('split');
    if (!isSplit) return candidate;
    
    const preferredSide = orient.splitOutwardSide;
    if (!preferredSide) return candidate;
    
    // Get all whole pieces
    const wholePlacements = (occupiedPlacements || []).filter(p => !this._isSplitFillPlacement(p));
    if (!wholePlacements.length) return candidate;
    
    const bb = orient.bb || getBoundingBox(orient.polygon);
    
    if (preferredSide === 'top') {
      const candidateCenterX = candidate.x + (bb.minX + bb.maxX) / 2;
      // Find closest whole piece column
      let bestP = null;
      let minDiffX = Infinity;
      for (const p of wholePlacements) {
        const pbb = p.orient.bb || getBoundingBox(p.orient.polygon);
        const pCenterX = p.x + (pbb.minX + pbb.maxX) / 2;
        const diffX = Math.abs(candidateCenterX - pCenterX);
        if (diffX < minDiffX) {
          minDiffX = diffX;
          bestP = p;
        }
      }
      
      if (bestP && minDiffX < 150) {
        const pbb = bestP.orient.bb || getBoundingBox(bestP.orient.polygon);
        const pCenterX = bestP.x + (pbb.minX + pbb.maxX) / 2;
        const snappedX = roundMetric(pCenterX - (bb.minX + bb.maxX) / 2, 3);
        return { ...candidate, x: snappedX };
      }
    } else if (preferredSide === 'right') {
      const candidateCenterY = candidate.y + (bb.minY + bb.maxY) / 2;
      // Find closest whole piece row
      let bestP = null;
      let minDiffY = Infinity;
      for (const p of wholePlacements) {
        const pbb = p.orient.bb || getBoundingBox(p.orient.polygon);
        const pCenterY = p.y + (pbb.minY + pbb.maxY) / 2;
        const diffY = Math.abs(candidateCenterY - pCenterY);
        if (diffY < minDiffY) {
          minDiffY = diffY;
          bestP = p;
        }
      }
      
      if (bestP && minDiffY < 150) {
        const pbb = bestP.orient.bb || getBoundingBox(bestP.orient.polygon);
        const pCenterY = bestP.y + (pbb.minY + pbb.maxY) / 2;
        const snappedY = roundMetric(pCenterY - (bb.minY + bb.maxY) / 2, 3);
        return { ...candidate, y: snappedY };
      }
    }
    
    return candidate;
  }"""

# 2. Target compaction start replacement
target_compaction_start = """  _compactSplitFillCandidatePlacement(candidate, orient, occupiedPlacements, config, workWidth, workHeight, providedSpatialIndex = null) {"""
replacement_compaction_start = align_method + "\n\n  _compactSplitFillCandidatePlacement(candidate, orient, occupiedPlacements, config, workWidth, workHeight, providedSpatialIndex = null) {\n    // Snap candidate to column/row center of whole pieces before compacting\n    candidate = this._alignSplitPlacementWithWholePieces(candidate, orient, occupiedPlacements, config);"

# 3. Locate the compaction directions sorting block and replace it using line splits
lines = normalized_content.split('\n')
found_compaction = False
found_top = False
found_right = False

for idx, line in enumerate(lines):
    # Match: const preferredSide = orient?.splitOutwardSide;
    if "const preferredSide = orient?.splitOutwardSide;" in line and "compactSplitFill" in "".join(lines[idx-40:idx]):
        # We found the block! Let's scan down to the end of the block (which ends with the matching "}")
        # Let's locate directions.sort and replace the whole block of directions.sort
        sort_start = -1
        sort_end = -1
        for j in range(idx, idx + 25):
            if "directions.sort" in lines[j]:
                sort_start = j
            if sort_start != -1 and lines[j].strip() == "});" and sort_end == -1:
                sort_end = j
                break
        
        if sort_start != -1 and sort_end != -1:
            replacement_sort = """      // Restrict axes of compaction to avoid drifting across columns or rows
      if (preferredSide === 'top' || preferredSide === 'bottom') {
        directions = directions.filter(d => d.axis === 'y');
      } else if (preferredSide === 'left' || preferredSide === 'right') {
        directions = directions.filter(d => d.axis === 'x');
      }

      directions.sort((a, b) => {
        // Squeeze against the whole pieces first: prioritize pushing towards opposite of preferredSide
        if (a.id === opposite) return -1;
        if (b.id === opposite) return 1;
        if (a.id === preferredSide) return 1;
        if (b.id === preferredSide) return -1;
        return 0;
      });"""
            lines[sort_start:sort_end+1] = [replacement_sort]
            found_compaction = True
            print("Successfully scheduled compaction patch!")
            break

# Re-join lines and search for Phase 2 top & right scans
normalized_content = "\n".join(lines)
lines = normalized_content.split('\n')

for idx, line in enumerate(lines):
    if "for (const orient of topOrients)" in line:
        # We found the top scan loop start! Let's check if the next lines contain the standard for (const x of topXs)
        for j in range(idx, idx + 15):
            if "for (const x of topXs)" in lines[j]:
                # Replace from "const bb = orient.bb" down to the inner loop start
                top_block_replacement = """        const bb = orient.bb || getBoundingBox(orient.polygon);
        const minY = -bb.minY; // Top edge of the sheet
        const maxScanY = workHeight - bb.maxY; // Absolute maximum Y scan

        const snappedXs = [];
        const seenSnappedX = new Set();
        const addSnappedX = (x) => {
          const rounded = roundMetric(x, 3);
          if (rounded + bb.minX < -1e-6 || rounded + bb.maxX > workWidth + 1e-6 || seenSnappedX.has(rounded)) return;
          seenSnappedX.add(rounded);
          snappedXs.push(rounded);
        };

        const wholePlacements = allPlacements.filter(p => !this._isSplitFillPlacement(p));
        for (const p of wholePlacements) {
          const pbb = p.orient.bb || getBoundingBox(p.orient.polygon);
          const pCenterX = p.x + (pbb.minX + pbb.maxX) / 2;
          const snappedX = pCenterX - (bb.minX + bb.maxX) / 2;
          addSnappedX(snappedX);
        }
        addSnappedX(-bb.minX);
        addSnappedX(workWidth - bb.maxX);

        for (const x of snappedXs) {"""
                lines[idx+1:j+2] = [top_block_replacement]
                found_top = True
                print("Successfully scheduled top scan patch!")
                break
        if found_top:
            break

# Re-join lines and search for Phase 2 right scan
normalized_content = "\n".join(lines)
lines = normalized_content.split('\n')

for idx, line in enumerate(lines):
    if "for (const orient of rightOrients)" in line:
        for j in range(idx, idx + 15):
            if "for (const y of rightYs)" in lines[j]:
                right_block_replacement = """        const bb = orient.bb || getBoundingBox(orient.polygon);
        const maxScanX = workWidth - bb.maxX; // Right edge of the sheet

        const snappedYs = [];
        const seenSnappedY = new Set();
        const addSnappedY = (y) => {
          const rounded = roundMetric(y, 3);
          if (rounded + bb.minY < -1e-6 || rounded + bb.maxY > workHeight + 1e-6 || seenSnappedY.has(rounded)) return;
          seenSnappedY.add(rounded);
          snappedYs.push(rounded);
        };

        const wholePlacements = allPlacements.filter(p => !this._isSplitFillPlacement(p));
        for (const p of wholePlacements) {
          const pbb = p.orient.bb || getBoundingBox(p.orient.polygon);
          const pCenterY = p.y + (pbb.minY + pbb.maxY) / 2;
          const snappedY = pCenterY - (bb.minY + bb.maxY) / 2;
          addSnappedY(snappedY);
        }
        addSnappedY(-bb.minY);
        addSnappedY(workHeight - bb.maxY);

        for (const y of snappedYs) {"""
                lines[idx+1:j+2] = [right_block_replacement]
                found_right = True
                print("Successfully scheduled right scan patch!")
                break
        if found_right:
            break

# Final replace of the compaction start
normalized_content = "\n".join(lines)
if found_compaction and found_top and found_right and target_compaction_start in normalized_content:
    updated = normalized_content.replace(target_compaction_start, replacement_compaction_start)
    with open(file_path, 'w', encoding='utf-8', newline='') as f:
        f.write(updated)
    print("Success: Fully patched the file with strict column and row alignment logic!")
else:
    print(f"Error: compaction={found_compaction}, top={found_top}, right={found_right}, start={target_compaction_start in normalized_content}")
