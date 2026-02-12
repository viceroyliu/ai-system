#!/bin/bash
# ============================================
# 修改 sync_service.py 中的 collection 名称
# knowledge → notion
# ============================================

cd ~/ai-system

echo "========================================"
echo "🔧 修改 sync_service.py"
echo "========================================"

# 备份
cp sync/sync_service.py sync/sync_service.py.bak.$(date +%Y%m%d%H%M%S)
echo "✅ 已备份"

# 修改 collection 名称
sed -i '' 's/get_or_create_collection("knowledge")/get_or_create_collection("notion")/g' sync/sync_service.py

echo "✅ collection 名称已改为 'notion'"

# 验证
echo ""
echo "验证修改结果:"
grep -n "collection" sync/sync_service.py | head -5

echo ""
echo "========================================"
echo "✅ 完成！"
echo "========================================"
