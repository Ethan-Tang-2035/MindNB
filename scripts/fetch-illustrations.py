"""Curate and vendor official MIT Fluent Emoji SVGs. Re-run with the downloaded Git tree."""
import concurrent.futures
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request
import time

ROOT = Path(__file__).resolve().parents[1]
TREE = Path('/tmp/mindnb-fluent-tree.json')
GROUPS = {
'工作': '''Briefcase|公文包;Laptop|笔记本电脑;Desktop computer|台式电脑;Keyboard|键盘;Computer mouse|鼠标;Printer|打印机;Telephone|电话;Mobile phone|手机;Fax machine|传真机;File folder|文件夹;Open file folder|打开文件夹;Card index dividers|分类文件;Clipboard|剪贴板;Calendar|日历;Spiral calendar|日程;Bar chart|柱状图;Chart increasing|增长趋势;Chart decreasing|下降趋势;Chart increasing with yen|财务增长;Money bag|资金;Dollar banknote|美元;Credit card|信用卡;Bank|银行;Office building|办公楼;Factory|工厂;Handshake|合作握手;Light bulb|灵感灯泡;Gear|设置齿轮;Toolbox|工具箱;Hammer and wrench|工具维修;Package|包裹;Inbox tray|收件箱;Outbox tray|发件箱;Envelope|信封;Memo|备忘录;Pushpin|图钉;Paperclip|回形针;Scissors|剪刀;Locked|上锁;Key|钥匙''',
'学习': '''Books|书籍;Open book|读书;Closed book|课本;Notebook|笔记本;Notebook with decorative cover|学习手册;Ledger|账簿;Pencil|铅笔;Pen|钢笔;Paintbrush|画笔;Crayon|蜡笔;Graduation cap|毕业帽;School|学校;School backpack|书包;Backpack|背包;Microscope|显微镜;Telescope|望远镜;Test tube|试管;Petri dish|培养皿;Dna|基因;Abacus|算盘;Straight ruler|直尺;Triangular ruler|三角尺;Artist palette|调色盘;Musical score|乐谱;Musical keyboard|钢琴;Guitar|吉他;Violin|小提琴;Globe showing asia-australia|地球;Globe with meridians|经纬地球;Magnifying glass tilted left|放大镜;Bookmark|书签;Scroll|卷轴;Page facing up|文稿;Page with curl|笔记页;Bookmark tabs|标签页;Brain|大脑;Atom symbol|原子;Balance scale|天平;Hourglass not done|时间学习;Alarm clock|闹钟''',
'人物': '''Artist|画家;Astronaut|宇航员;Cook|厨师;Farmer|农民;Firefighter|消防员;Health worker|医护人员;Judge|法官;Mechanic|技工;Office worker|上班族;Pilot|飞行员;Scientist|科学家;Singer|歌手;Student|学生;Teacher|教师;Technologist|程序员;Factory worker|工人;Construction worker|建筑工人;Police officer|警察;Detective|侦探;Baby|婴儿;Child|儿童;Person|成年人;Older person|长者;Person running|跑步;Person walking|步行;Person biking|骑行;Person in lotus position|冥想;Person swimming|游泳;Person lifting weights|举重;Person climbing|攀岩;Person reading|阅读;Person raising hand|举手;Person shrugging|耸肩;Person facepalming|捂脸;Person gesturing ok|同意手势;Grinning face|开心;Thinking face|思考;Smiling face|微笑;Face with tears of joy|大笑;Sleeping face|睡眠;Face with thermometer|生病;Star-struck|惊喜''',
'生活': '''House|房子;House with garden|家园;Bed|床;Couch and lamp|沙发;Bathtub|浴缸;Shower|淋浴;Toothbrush|牙刷;Soap|香皂;Basket|篮子;Shopping cart|购物车;Shopping bags|购物袋;T-shirt|上衣;Jeans|牛仔裤;Dress|裙子;Running shoe|运动鞋;Umbrella|雨伞;Hot beverage|咖啡热饮;Teacup without handle|茶;Cooking|煎蛋;Steaming bowl|面条;Cooked rice|米饭;Bread|面包;Birthday cake|生日蛋糕;Red apple|苹果;Banana|香蕉;Avocado|牛油果;Broccoli|西兰花;Carrot|胡萝卜;Pizza|披萨;Hamburger|汉堡;Dog|狗;Cat|猫;Rabbit|兔子;Bird|鸟;Fish|鱼;Potted plant|盆栽;Seedling|幼苗;Sunflower|向日葵;Rose|玫瑰;Soccer ball|足球;Basketball|篮球;Tennis|网球;Badminton|羽毛球;Video game|游戏;Headphone|耳机;Camera|相机;Television|电视;Wrapped gift|礼物;Balloon|气球;Party popper|庆祝''',
'旅行': '''Airplane|飞机;Airplane departure|起飞;Airplane arrival|降落;Automobile|汽车;Taxi|出租车;Bus|公交车;Train|火车;High-speed train|高铁;Bicycle|自行车;Motor scooter|摩托车;Sailboat|帆船;Ship|轮船;Rocket|火箭;Helicopter|直升机;Luggage|行李;World map|世界地图;Compass|指南针;Round pushpin|位置;Camping|露营;Tent|帐篷;Beach with umbrella|海滩;Desert island|海岛;Mountain|山峰;Snow-capped mountain|雪山;Mount fuji|富士山;National park|国家公园;Desert|沙漠;Sunrise|日出;Sunset|日落;Bridge at night|夜景桥梁;Ferris wheel|摩天轮;Roller coaster|过山车;Hotel|酒店;Castle|城堡;Stadium|体育场;Statue of liberty|自由女神像;Tokyo tower|东京塔;Ticket|门票;Passport control|护照;Baggage claim|行李提取''',
'符号': '''Check mark button|完成;Check mark|对勾;Cross mark|错误;Question mark|疑问;Exclamation mark|注意;Warning|警告;Prohibited|禁止;Recycling symbol|循环回收;Infinity|无限;Heart suit|爱心;Red heart|红心;Star|星星;Glowing star|闪亮星;Sparkles|闪光;Fire|火焰;High voltage|闪电;Hundred points|满分;1st place medal|第一名;2nd place medal|第二名;3rd place medal|第三名;Trophy|奖杯;Bullseye|目标;Direct hit|靶心;Chequered flag|终点;Triangular flag|旗帜;Right arrow|向右;Left arrow|向左;Up arrow|向上;Down arrow|向下;Clockwise vertical arrows|循环;Counterclockwise arrows button|刷新;Plus|加号;Minus|减号;Multiply|乘号;Divide|除号;Heavy equals sign|等号;Information|信息;Speech balloon|对话;Thought balloon|想法;Bell|通知'''
}

def download(url, destination):
    if destination.exists() and destination.stat().st_size > 50: return
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'mindnb-asset-vendor'})
            with urllib.request.urlopen(req, timeout=40) as response: data = response.read()
            if destination.suffix == '.svg' and b'<svg' not in data: raise ValueError('Not an SVG')
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            return
        except Exception:
            if attempt == 2: raise
            time.sleep(attempt + 1)

if __name__ == '__main__':
    paths = [i['path'] for i in json.loads(TREE.read_text())['tree'] if '/Flat/' in i['path'] and i['path'].endswith('.svg')]
    lookup = {}
    for p in sorted(paths, key=lambda s: (len(s), s)):
        lookup.setdefault(p.split('/')[1].lower(), p)
    entries = []
    missing = []
    for category, raw in GROUPS.items():
        for item in raw.split(';'):
            english, name = item.split('|')
            path = lookup.get(english.lower())
            if not path:
                missing.append(english); continue
            slug = re.sub(r'[^a-z0-9]+', '-', english.lower()).strip('-')
            entries.append({'id': 'fluent-' + slug, 'name': name, 'category': category, 'tags': [category, english, name, '彩色'], 'stroke': [], 'src': '/illustrations/fluent/' + slug + '.svg', 'source': 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/' + urllib.parse.quote(path), 'license': 'MIT', 'scene': False})
    assert len(entries) >= 200, f'Only {len(entries)} matching assets; missing {missing}'
    print(f'Curated {len(entries)} distinct stickers; unavailable aliases: {missing}', flush=True)
    def fetch(entry): download(entry['source'], ROOT / 'public' / entry['src'].lstrip('/'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: list(pool.map(fetch, entries))
    (ROOT / 'src/illustrations.generated.json').write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n')
    (ROOT / 'public/illustrations/manifest.json').write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n')
    print(f'Vendored {len(entries)} SVGs and license manifest.', flush=True)
