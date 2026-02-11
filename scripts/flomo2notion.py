#!/usr/bin/env python3
"""
Flomo HTML 导入到 Notion 闪念
- 保留 Markdown 格式
- 单级标签：从内容删除，加到属性
- 多级标签：内容保留，属性只加一级
- 创建日期：使用 Flomo 原始日期
- 标题：暂时为空，由同步服务自动生成
"""
import re
import os
import sys
import yaml
from datetime import datetime
from pathlib import Path
from notion_client import Client

CONFIG_PATH = Path.home() / "ai-system/config/notion.yaml"
with open(CONFIG_PATH, 'r') as f:
    config = yaml.safe_load(f)

notion = Client(auth=config['notion']['token'])
DATABASE_ID = config['notion']['databases'].get('闪念')

def parse_markdown_to_blocks(text):
    """将 Markdown 文本转换为 Notion blocks"""
    blocks = []
    lines = text.split('\n')
    
    for line in lines:
        if not line.strip():
            continue
        
        if line.strip().startswith('- ') or line.strip().startswith('• '):
            content = line.strip()[2:]
            blocks.append({
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {
                    "rich_text": parse_rich_text(content)
                }
            })
        elif re.match(r'^\d+[\.\、]\s*', line.strip()):
            content = re.sub(r'^\d+[\.\、]\s*', '', line.strip())
            blocks.append({
                "object": "block",
                "type": "numbered_list_item",
                "numbered_list_item": {
                    "rich_text": parse_rich_text(content)
                }
            })
        else:
            blocks.append({
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": parse_rich_text(line)
                }
            })
    
    return blocks

def parse_rich_text(text):
    """解析富文本，处理加粗"""
    rich_text = []
    pattern = r'\*\*(.+?)\*\*'
    last_end = 0
    
    for match in re.finditer(pattern, text):
        if match.start() > last_end:
            plain = text[last_end:match.start()]
            if plain:
                rich_text.append({"type": "text", "text": {"content": plain}})
        
        rich_text.append({
            "type": "text",
            "text": {"content": match.group(1)},
            "annotations": {"bold": True}
        })
        last_end = match.end()
    
    if last_end < len(text):
        remaining = text[last_end:]
        if remaining:
            rich_text.append({"type": "text", "text": {"content": remaining}})
    
    if not rich_text:
        rich_text.append({"type": "text", "text": {"content": text}})
    
    return rich_text

def process_tags_and_content(content):
    """处理标签和内容"""
    tags_raw = re.findall(r'#([\w\u4e00-\u9fff/]+)', content)
    
    property_tags = set()
    
    for tag in tags_raw:
        if '/' in tag:
            first_level = tag.split('/')[0]
            property_tags.add(first_level)
        else:
            property_tags.add(tag)
            content = re.sub(r'#' + re.escape(tag) + r'(?![/\w\u4e00-\u9fff])', '', content)
    
    content = re.sub(r'\n{3,}', '\n\n', content)
    content = content.strip()
    
    return content, list(property_tags)

def parse_flomo_date(time_str):
    """解析 Flomo 日期格式"""
    try:
        # Flomo 格式: 2026-01-05 22:28:53
        dt = datetime.strptime(time_str.strip(), '%Y-%m-%d %H:%M:%S')
        return dt.strftime('%Y-%m-%d')
    except:
        return datetime.now().strftime('%Y-%m-%d')

def extract_memos(html_content):
    memos = []
    memo_pattern = r'<div class="memo">\s*<div class="time">(.*?)</div>\s*<div class="content">(.*?)</div>\s*<div class="files">(.*?)</div>'
    matches = re.findall(memo_pattern, html_content, re.DOTALL)
    
    for time_str, content_html, files_html in matches:
        time_str = time_str.strip()
        
        content = content_html
        content = re.sub(r'<p>\s*</p>', '\n', content)
        content = re.sub(r'<p>', '', content)
        content = re.sub(r'</p>', '\n', content)
        content = re.sub(r'<br\s*/?>', '\n', content)
        content = re.sub(r'<strong>', '**', content)
        content = re.sub(r'</strong>', '**', content)
        content = re.sub(r'<ul.*?>', '', content)
        content = re.sub(r'</ul>', '', content)
        content = re.sub(r'<ol.*?>', '', content)
        content = re.sub(r'</ol>', '', content)
        content = re.sub(r'<li>\s*<p>', '- ', content)
        content = re.sub(r'<li>', '- ', content)
        content = re.sub(r'</li>', '\n', content)
        content = re.sub(r'<.*?>', '', content)
        content = re.sub(r'\n{3,}', '\n\n', content)
        content = content.strip()
        
        content, tags = process_tags_and_content(content)
        images = re.findall(r'<img[^>]+src="([^"]+)"', files_html)
        
        if content:
            memos.append({
                'time': time_str,
                'date': parse_flomo_date(time_str),
                'content': content,
                'tags': tags,
                'images': images
            })
    
    return memos

def create_notion_page(memo):
    blocks = parse_markdown_to_blocks(memo['content'][:2000])
    
    for img_url in memo['images']:
        if img_url.startswith('http'):
            blocks.append({
                "object": "block",
                "type": "image",
                "image": {"type": "external", "external": {"url": img_url}}
            })
    
    properties = {
        "名称": {"title": [{"text": {"content": ""}}]},  # 标题为空，由 AI 生成
        "创建日期": {"date": {"start": memo['date']}}
    }
    
    if memo['tags']:
        properties["标签"] = {
            "multi_select": [{"name": tag} for tag in memo['tags'][:10]]
        }
    
    try:
        notion.pages.create(
            parent={"database_id": DATABASE_ID},
            properties=properties,
            children=blocks[:100]
        )
        return True
    except Exception as e:
        print(f"\n  ❌ 错误: {e}")
        return False

def main():
    if len(sys.argv) < 2:
        print("用法: python3 flomo2notion.py <flomo导出.html>")
        sys.exit(1)
    
    html_file = sys.argv[1]
    
    if not os.path.exists(html_file):
        print(f"文件不存在: {html_file}")
        sys.exit(1)
    
    print(f"📂 读取: {html_file}")
    
    with open(html_file, 'r', encoding='utf-8') as f:
        html_content = f.read()
    
    memos = extract_memos(html_content)
    print(f"📝 共 {len(memos)} 条\n")
    
    if not DATABASE_ID:
        print("❌ 配置中没有「闪念」数据库 ID")
        sys.exit(1)
    
    success = 0
    for i, memo in enumerate(memos, 1):
        tags_str = ', '.join(memo['tags'][:3]) if memo['tags'] else '无标签'
        print(f"[{i}/{len(memos)}] {memo['date']} | {tags_str}...", end=" ")
        if create_notion_page(memo):
            print("✅")
            success += 1
        else:
            print("❌")
    
    print(f"\n✅ 完成！{success}/{len(memos)} 条")
    print(f"💡 运行 ai-sync 让 AI 自动生成标题")

if __name__ == "__main__":
    main()
