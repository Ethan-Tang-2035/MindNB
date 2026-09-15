"""Compose 30 distinct SVG scenes from CC0 Open Doodles and original setting drawings."""
import json,re,urllib.request,concurrent.futures
from pathlib import Path
from xml.etree import ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'public/illustrations/scenes/sources'
CACHE.mkdir(parents=True,exist_ok=True)
DATA=[
('dashboard','工作','数据分析','sitting','dashboard'),('presentation','工作','方案汇报','strolling','presentation'),('kanban','工作','项目看板','sleek','kanban'),('coding','工作','程序开发','sitting','coding'),('meeting','工作','团队会议','sitting','meeting'),('shipping','工作','订单发货','unboxing','shipping'),
('classroom','学习','课堂学习','reading','classroom'),('library','学习','图书馆阅读','sitting-reading','library'),('laboratory','学习','科学实验','sleek','laboratory'),('astronomy','学习','天文观测','strolling','astronomy'),('music','学习','音乐练习','sitting','music'),('painting','学习','绘画创作','sleek','painting'),
('kitchen','生活','烹饪晚餐','strolling','kitchen'),('cafe','生活','咖啡休息','coffee','cafe'),('garden','生活','花园种植','plant','garden'),('home','生活','居家阅读','reading-side','home'),('gym','生活','力量训练','sprinting','gym'),('park','生活','公园遛狗','petting','park'),
('beach','旅行','海边度假','bikini','beach'),('camping','旅行','野外露营','sitting','camping'),('airport','旅行','机场出发','strolling','airport'),('railway','旅行','铁路旅行','strolling','railway'),('hiking','旅行','山间徒步','sprinting','hiking'),('city','旅行','城市漫游','selfie','city'),
('mentoring','人物','导师辅导','sitting-reading','mentoring'),('birthday','人物','生日聚会','loving','birthday'),('celebration','人物','团队庆功','jumping','celebration'),('clinic','人物','健康咨询','sitting','clinic'),('family','人物','家庭团聚','loving','family'),('yoga','人物','清晨冥想','meditating','yoga')]
INK='#37372f'; CORAL='#ec8e78'; GREEN='#8daa8b'; YELLOW='#eed895'
def rect(x,y,w,h,fill='none',r=5):return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"/>'
def path(d,fill='none'):return f'<path d="{d}" fill="{fill}"/>'
def circle(x,y,r,fill='none'):return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"/>'
def line(x,y,X,Y):return path(f'M{x} {y}L{X} {Y}')
def board():return rect(26,38,182,126,'#fffdf7')+line(60,164,48,208)+line(174,164,186,208)
def desk():return rect(20,166,192,9,YELLOW)+line(32,175,32,218)+line(198,175,198,218)
def setting(kind):
    if kind=='dashboard':return board()+''.join(rect(44+i*31,135-h,20,h,[CORAL,GREEN,YELLOW][i%3]) for i,h in enumerate([24,46,35,70]))+path('M40 80L76 66L108 72L160 48')
    if kind=='presentation':return board()+circle(76,89,28,CORAL)+path('M76 89V61A28 28 0 0 1 104 89Z',YELLOW)+''.join(line(120,72+i*21,188,72+i*21) for i in range(3))
    if kind=='kanban':return board()+''.join(rect(38+i*54,49,46,15,[CORAL,GREEN,YELLOW][i]) + ''.join(rect(40+i*54,74+j*26,40,19,'#f3ead5') for j in range(3-i)) for i in range(3))
    if kind=='coding':return desk()+rect(38,67,146,91,'#e3ece0')+path('M78 93L61 106L78 119M141 93L157 106L141 119M117 88L99 126')+line(110,158,110,166)
    if kind=='meeting':return desk()+rect(72,126,66,39,CORAL)+circle(49,113,16,GREEN)+path('M25 158Q49 122 70 158')+circle(169,108,16,YELLOW)+path('M147 155Q169 121 194 155')
    if kind=='shipping':return ''.join(rect(x,y,50,42,fill)+line(x+25,y,x+25,y+42)+path(f'M{x+8} {y+9}h13') for x,y,fill in [(30,170,YELLOW),(85,170,CORAL),(57,124,GREEN)])+path('M23 215H200M156 210V169H203V210M156 174H203')
    if kind=='classroom':return board()+path('M48 72h28M62 58v28M91 72h24M91 81h24M146 57L130 86H163M58 120L92 139L133 111')
    if kind=='library':return rect(26,35,164,174,'#f6edd6')+''.join(line(26,y,190,y) for y in [92,150])+''.join(rect(39+i*26,42+j*58,18,43,[CORAL,GREEN,YELLOW][(i+j)%3]) for i in range(5) for j in range(3))
    if kind=='laboratory':return desk()+path('M48 97H82M57 97V132L37 160H91L73 132V97',GREEN)+path('M125 90H143M128 90V144Q135 159 142 144V90',CORAL)+circle(134,117,3)+circle(65,70,9,YELLOW)
    if kind=='astronomy':return circle(147,50,18,YELLOW)+path('M35 115L151 63L163 85L46 138Z',GREEN)+path('M103 113V149M103 149L57 211M103 149L148 211M103 149V218')+''.join(path(f'M{x-4} {y}h8M{x} {y-4}v8') for x,y in [(35,52),(192,102),(83,28)])
    if kind=='music':return rect(27,120,178,63,'#fffdf8')+''.join(line(42+i*16,120,42+i*16,183) for i in range(10))+''.join(rect(36+i*29,120,8,33,INK,0) for i in range(6))+path('M42 183V215M190 183V215M106 70V34L140 26V63')+circle(97,71,9,CORAL)+circle(131,65,9,CORAL)
    if kind=='painting':return rect(52,53,127,127,'#fffdf8')+path('M68 162L102 103L124 139L147 86L168 162Z',GREEN)+circle(86,82,12,YELLOW)+path('M113 180L70 217M113 180L158 217M113 53V32')
    if kind=='kitchen':return desk()+rect(38,175,149,41,'#f6edd6')+rect(40,72,143,51,GREEN)+line(112,72,112,123)+path('M55 158Q53 128 109 134L102 159Z',CORAL)+path('M112 140h19M72 120Q62 107 77 99M93 122Q83 108 98 100')
    if kind=='cafe':return desk()+path('M42 128H98L92 159H48Z',CORAL)+path('M98 134Q128 129 108 151H97M54 116Q45 104 60 96M77 115Q68 101 84 93')+rect(142,94,48,70,GREEN)+rect(30,45,83,24,YELLOW)
    if kind=='garden':return ''.join(path(f'M{x} 170V113M{x} 143Q{x-29} 110 {x-32} 132Q{x-22} 150 {x} 143M{x} 133Q{x+28} 100 {x+33} 121Q{x+20} 143 {x} 133',GREEN)+rect(x-22,170,44,42,CORAL) for x in [55,139])+circle(105,43,17,YELLOW)
    if kind=='home':return rect(25,133,178,67,GREEN,15)+rect(37,113,66,39,YELLOW,12)+rect(115,113,72,39,CORAL,12)+path('M40 200V216M188 200V216M57 93V51H92V93Z')+rect(121,43,65,48,'#fffdf8')+circle(153,66,13,YELLOW)
    if kind=='gym':return path('M31 175H190M67 175V133M155 175V133')+''.join(rect(x,136,18,70,GREEN) for x in [27,49,168,190])+line(67,165,169,165)+circle(105,72,31,CORAL)+path('M105 53V72L125 84')
    if kind=='park':return path('M39 206V125M170 209V96')+circle(39,99,36,GREEN)+circle(170,71,42,GREEN)+path('M24 216Q92 177 209 214')+rect(78,156,75,10,YELLOW)+line(86,166,86,197)+line(143,166,143,197)
    if kind=='beach':return path('M20 166Q55 153 90 166T160 166T216 166M20 184Q55 171 90 184T160 184T216 184')+path('M45 105Q103 13 164 105Z',CORAL)+path('M105 60V213M45 105Q80 79 105 105Q137 79 164 105')+circle(192,44,20,YELLOW)
    if kind=='camping':return path('M25 202L108 83L194 202Z',GREEN)+path('M74 202L109 135L146 202Z','#fffdf8')+path('M166 213L201 196M166 196L201 213M180 192Q167 171 185 159Q205 184 180 192',CORAL)+circle(48,40,16,YELLOW)
    if kind=='airport':return rect(28,55,179,106,'#e8efe9')+path('M29 125L206 92M94 64V155M161 58V158M53 89L135 68L170 73L133 84L112 106L98 106L107 86Z',CORAL)+rect(73,180,65,35,YELLOW)+path('M89 180V169H122V180')
    if kind=='railway':return rect(25,76,178,99,GREEN,15)+''.join(rect(38+i*51,88,40,35,'#fffdf8') for i in range(3))+circle(61,179,13,INK)+circle(170,179,13,INK)+path('M17 201H214M17 213H214')
    if kind=='hiking':return path('M14 201L73 80L125 142L165 59L221 201Z',GREEN)+path('M51 123L73 80L99 111L83 105L69 121Z','#fffdf8')+path('M143 98L165 59L188 115L168 94L155 106Z','#fffdf8')+path('M104 203Q134 181 120 162Q108 147 137 138')+circle(45,43,18,YELLOW)
    if kind=='city':return rect(19,111,42,101,GREEN)+rect(71,64,56,148,YELLOW)+rect(140,91,61,121,CORAL)+''.join(rect(x,y,9,12,'#fffdf8',1) for x in [30,47,83,106,153,176] for y in [125,153,180])+path('M97 64V43M20 217H218')
    if kind=='mentoring':return desk()+rect(47,116,102,44,'#fffdf8')+path('M97 119V156M57 130H84M109 131H140')+rect(105,37,91,44,GREEN,14)+path('M131 81L123 99L153 81')
    if kind=='birthday':return path('M44 152H174V204H44Z',CORAL)+path('M44 163Q60 183 75 163Q93 183 109 163Q129 183 144 163Q159 183 174 163')+''.join(path(f'M{x} 150V119')+path(f'M{x} 115Q{x-9} 106 {x} 96Q{x+9} 106 {x} 115',YELLOW) for x in [76,110,144])+circle(37,66,22,GREEN)+line(37,89,48,141)
    if kind=='celebration':return path('M53 211L88 122L148 183Z',CORAL)+''.join(path(f'M{x} {y}l8 -12l8 10') for x,y in [(113,65),(149,100),(51,77),(191,154)])+''.join(circle(x,y,5,YELLOW) for x,y in [(169,47),(76,42),(192,102),(117,92)])+path('M140 136Q182 129 188 178M104 110Q92 69 123 47')
    if kind=='clinic':return rect(26,87,173,110,'#fffdf8')+rect(39,117,58,34,CORAL)+path('M63 108V160M47 134H88')+rect(117,109,64,62,GREEN)+path('M125 146H138L145 125L154 160L163 143H177')+line(43,197,43,216)+line(184,197,184,216)
    if kind=='family':return path('M16 112L108 43L208 112Z',CORAL)+rect(35,112,157,102,'#fffdf8')+rect(94,148,43,66,GREEN)+rect(49,130,30,28,YELLOW)+rect(148,130,30,28,YELLOW)+path('M105 102C67 79 90 58 107 79C131 53 150 82 105 102',CORAL)
    if kind=='yoga':return circle(108,96,51,YELLOW)+path('M20 154Q68 119 113 153Q164 188 215 150')+path('M18 199Q87 179 211 205')+rect(29,208,170,10,GREEN)+path('M58 116L38 145M169 117L192 144')
    raise ValueError(kind)

def fetch(name):
    target=CACHE/(name+'.svg')
    if not target.exists():
        req=urllib.request.Request(f'https://opendoodles.s3-us-west-1.amazonaws.com/{name}.svg',headers={'User-Agent':'mindnb'})
        with urllib.request.urlopen(req,timeout=45) as r: target.write_bytes(r.read())
    return target
if __name__=='__main__':
    names=sorted({r[3] for r in DATA})
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:list(pool.map(fetch,names))
    entries=[]
    for slug,category,name,figure,kind in DATA:
        root=ET.fromstring((CACHE/(figure+'.svg')).read_text())
        root.set('x','195');root.set('y','51');root.set('width','188');root.set('height','180')
        person=ET.tostring(root,encoding='unicode')
        svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260"><title>{name}</title><ellipse cx="206" cy="226" rx="179" ry="12" fill="#dfd6c5" opacity=".4"/><g stroke="{INK}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">{setting(kind)}</g>{person}</svg>'
        target=ROOT/'public/illustrations/scenes'/f'{slug}.svg';target.write_text(svg)
        entries.append({'id':'scene-'+slug,'name':name,'category':category,'tags':[name,category,'场景','手绘',kind],'scene':True,'stroke':[],'src':'/illustrations/scenes/'+slug+'.svg','source':'https://opendoodles.s3-us-west-1.amazonaws.com/'+figure+'.svg','license':'CC0-1.0 (Open Doodles figure); original project setting and composition','composition':kind})
    (ROOT/'src/scenes.generated.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
    fluent=json.loads((ROOT/'src/illustrations.generated.json').read_text())
    (ROOT/'public/illustrations/manifest.json').write_text(json.dumps(fluent+entries,ensure_ascii=False,indent=2)+'\n')
    (ROOT/'public/illustrations/scenes/NOTICE.txt').write_text('Open Doodles figures by Pablo Stanley: CC0 1.0. https://www.opendoodles.com/about\nOriginal setting drawings and compositions authored for mindnb; source: scripts/build-scenes.py.\n30 distinct settings, not recolored figure variants.\n')
    print('Built 30 distinct scene compositions with source manifest.',flush=True)
