import os

file_path = r'c:\Users\long.nh\Desktop\Automatically-optimize-layout\server\algorithms\diecut\strategies\capacity\double-contour\CapacityTestDoubleInsoleDoubleContourPattern.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace any CRLF with LF to normalize
normalized_content = content.replace('\r\n', '\n')

# 1. Patch the _scorePreparedEdgePlacementCandidate return statement
target_score = """    return (
      preferredDistance * 0.4 +
      nearestEdgeDistance * 0.3 +
      proximityBonus * 1.5 + 
      candidate.y * 0.01 +   
      candidate.x * 0.005    
    );"""

replacement_score = """    let finalScore = (
      preferredDistance * 0.4 +
      nearestEdgeDistance * 0.3 +
      proximityBonus * 1.5 + 
      candidate.y * 0.01 +   
      candidate.x * 0.005    
    );

    if (orient.isSplit || orient.foot?.startsWith('split')) {
      if (preferredSide === 'top') {
        // Top margin: Deep valleys (larger Y) are heavily prioritized (lower score is better)
        finalScore = -candidate.y * 1000 + candidate.x * 0.1;
      } else if (preferredSide === 'right') {
        // Right margin: Deep valleys leftwards (smaller X) are heavily prioritized
        finalScore = candidate.x * 1000 + (workHeight - candidate.y) * 0.1;
      }
    }

    return finalScore;"""

# 2. Patch the compaction directions sorting in _compactSplitFillCandidatePlacement
target_compaction = """      directions.sort((a, b) => {
        if (a.id === preferredSide) return -1;
        if (b.id === preferredSide) return 1;
        if (a.id === opposite) return 1;
        if (b.id === opposite) return -1;
        return 0;
      });"""

replacement_compaction = """      directions.sort((a, b) => {
        // Squeeze against the whole pieces first: prioritize pushing towards opposite of preferredSide
        if (a.id === opposite) return -1;
        if (b.id === opposite) return 1;
        if (a.id === preferredSide) return 1;
        if (b.id === preferredSide) return -1;
        return 0;
      });"""

# Normalize target to LF
target_score_lf = target_score.replace('\r\n', '\n').strip()
replacement_score_lf = replacement_score.replace('\r\n', '\n')

target_compaction_lf = target_compaction.replace('\r\n', '\n').strip()
replacement_compaction_lf = replacement_compaction.replace('\r\n', '\n')

if target_score_lf in normalized_content and target_compaction_lf in normalized_content:
    updated_content = normalized_content.replace(target_score_lf, replacement_score_lf)
    updated_content = updated_content.replace(target_compaction_lf, replacement_compaction_lf)
    
    # Save back with platform native line endings
    with open(file_path, 'w', encoding='utf-8', newline='') as f:
        f.write(updated_content)
    print("Success: Patched file successfully!")
else:
    if target_score_lf not in normalized_content:
        print("Error: target_score not found!")
    if target_compaction_lf not in normalized_content:
        print("Error: target_compaction not found!")
