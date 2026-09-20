// Executed only inside an ephemeral, network-denied Sandbox. Never eval in web runtime.
export const importParserSource = String.raw`
import sys,json,io,zipfile,csv,re,resource
from html.parser import HTMLParser
from xml.etree import ElementTree as ET
resource.setrlimit(resource.RLIMIT_CPU,(50,50))
if sys.platform=='linux': resource.setrlimit(resource.RLIMIT_AS,(768*1024*1024,768*1024*1024))
resource.setrlimit(resource.RLIMIT_FSIZE,(4*1024*1024,4*1024*1024))
fragments=[]; warnings=[]; total=0
def fail(code): raise ValueError(code)
def emit(text,locator,trim=True):
 global total
 if trim: text=text.strip()
 if not text: return
 for key,value in locator.items():
  if key in ('page','paragraph','row','column') and (value<1 or value>(300 if key=='page' else 1000000)): fail('limit_exceeded')
 if '\x00' in text or len(text)>20000: fail('limit_exceeded')
 total+=len(text.encode('utf-8'))
 if total>1000000 or len(fragments)>=10000: fail('limit_exceeded')
 fragments.append({'text':text,'locator':locator})
def pieces(text):
 # Bounded chunks, prefer sentence/line boundaries without dropping source text.
 offset=0
 while len(text)-offset>1600:
  window=text[offset:offset+1600]
  ends=[m.end() for m in re.finditer(r'[。！？!?；;]\s*|[.]\s+|\n',window) if m.end()>=800]
  end=ends[-1] if ends else 1600
  yield text[offset:offset+end],offset
  offset+=end
 if text[offset:]: yield text[offset:],offset
def blocks(items,base=None):
 pending=[]; start=0; last=0; size=0
 def flush():
  if pending:
   loc=dict(base or {}); loc.update({'paragraph':start,'region':'paragraphs %d-%d'%(start,last)})
   emit('\n\n'.join(pending),loc)
 for number,text,heading in items:
  text=text.strip()
  if not text: continue
  if '\x00' in text: fail('limit_exceeded')
  if pending and (heading or size>=800 or size+2+len(text)>1600):
   flush(); pending=[]; size=0
  if len(text)>1600:
   for part,offset in pieces(text):
    loc=dict(base or {}); loc.update({'paragraph':number,'region':'paragraph %d chars %d-%d'%(number,offset+1,offset+len(part))})
    emit(part,loc,trim=False)
  else:
   if not pending: start=number
   pending.append(text); last=number; size+=len(text)+(2 if len(pending)>1 else 0)
 flush()
def paragraphs(text,base=None,markdown=False):
 text=text.replace('\r\n','\n').replace('\r','\n')
 items=[]; lines=[]; heading=False; fence=None
 def finish():
  if lines: items.append((len(items)+1,'\n'.join(lines),heading))
 for line in text.split('\n'):
  marker=re.match(r'^ {0,3}(\x60{3,}|~{3,})',line) if markdown else None
  if fence:
   lines.append(line)
   if re.fullmatch(r' {0,3}'+re.escape(fence[0])+'{'+str(len(fence))+r',}\s*',line): fence=None
   continue
  is_heading=markdown and bool(re.match(r'^ {0,3}#{1,6}\s',line))
  if not line.strip() or is_heading:
   finish(); lines=[]; heading=False
  if line.strip():
   lines.append(line); heading=heading or is_heading
  if marker: fence=marker[1]
 finish()
 blocks(items,base)
def xml(data):
 if b'\x00' in data or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper(): fail('unsupported_content')
 return ET.fromstring(data)
def archive(data):
 z=zipfile.ZipFile(io.BytesIO(data)); infos=z.infolist()
 if len(infos)>5000 or sum(i.file_size for i in infos)>100*1024*1024: fail('limit_exceeded')
 for i in infos:
  if i.filename.lower().endswith('vbaproject.bin'): fail('unsupported_content')
  if i.flag_bits&1 or i.file_size>25*1024*1024 or i.file_size>max(1,i.compress_size)*200: fail('limit_exceeded')
 if len({i.filename for i in infos})!=len(infos): fail('unsupported_content')
 return z
class HTMLText(HTMLParser):
 def __init__(self): super().__init__(convert_charrefs=True); self.skip=0; self.parts=[]; self.items=[]; self.heading=False; self.pre=0
 def boundary(self):
  text=''.join(self.parts)
  if not self.pre: text=re.sub(r'\s+',' ',text)
  text=text.strip()
  if text: self.items.append((len(self.items)+1,text,self.heading))
  self.parts=[]; self.heading=False
 def handle_starttag(self,tag,attrs):
  if tag in ('script','style','noscript','template'): self.skip+=1
  if self.skip: return
  if tag in ('p','div','section','article','h1','h2','h3','h4','h5','h6','li','tr','blockquote','pre'):
   self.boundary(); self.heading=tag in ('h1','h2','h3','h4','h5','h6')
   if tag=='pre': self.pre+=1
  elif tag in ('br','td','th'): self.parts.append('\n' if self.pre and tag=='br' else ' ')
 def handle_endtag(self,tag):
  if tag in ('script','style','noscript','template') and self.skip:
   self.skip-=1; return
  if not self.skip and tag in ('p','div','section','article','h1','h2','h3','h4','h5','h6','li','tr','blockquote','pre'): self.boundary()
  if not self.skip and tag=='pre' and self.pre: self.pre-=1
 def handle_data(self,data):
  if not self.skip: self.parts.append(data)
try:
 data=open(sys.argv[1],'rb').read(25*1024*1024+1); fmt=sys.argv[2]
 if not data or len(data)>25*1024*1024: fail('limit_exceeded')
 if fmt in ('text','markdown','html','csv'):
  if data.startswith((b'%PDF-',b'PK\x03\x04',b'\x89PNG',b'\xff\xd8')): fail('unsupported_content')
  text=data.decode('utf-8-sig',errors='strict')
  if fmt=='html':
   p=HTMLText(); p.feed(text); p.close(); p.boundary(); blocks(p.items)
  elif fmt=='csv':
   csv.field_size_limit(20000)
   for row,values in enumerate(csv.reader(io.StringIO(text)),1):
    if row>1000000: fail('limit_exceeded')
    for col,value in enumerate(values,1): emit(value,{'row':row,'column':col})
  else: paragraphs(text,markdown=fmt=='markdown')
 elif fmt=='docx':
  z=archive(data); root=xml(z.read('word/document.xml'))
  ns='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
  items=[]
  for i,p in enumerate(root.iter(ns+'p'),1):
   style=p.find(ns+'pPr/'+ns+'pStyle')
   heading=style is not None and bool(re.match(r'(?i)^(heading|title)',style.get(ns+'val','')))
   items.append((i,''.join(t.text or '' for t in p.iter(ns+'t')),heading))
  blocks(items)
 elif fmt=='xlsx':
  z=archive(data); ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():
   strings=[''.join(t.text or '' for t in si.iter('{'+ns['s']+'}t')) for si in xml(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]
  book=xml(z.read('xl/workbook.xml')); rels=xml(z.read('xl/_rels/workbook.xml.rels'))
  targets={r.get('Id'):r.get('Target') for r in rels if r.get('TargetMode')!='External'}
  for sheet in book.findall('s:sheets/s:sheet',ns):
   target=targets.get(sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'),'')
   if not re.fullmatch(r'(?:/xl/)?worksheets/sheet[0-9]+\.xml',target): fail('unsupported_content')
   path=target.lstrip('/') if target.startswith('/') else 'xl/'+target
   for row in xml(z.read(path)).findall('s:sheetData/s:row',ns):
    for c in row.findall('s:c',ns):
     m=re.fullmatch(r'([A-Z]{1,3})([0-9]+)',c.get('r',''))
     if not m: fail('unsupported_content')
     col=0
     for ch in m[1]: col=col*26+ord(ch)-64
     if c.find('s:f',ns) is not None and 'formula_cached_only' not in warnings: warnings.append('formula_cached_only')
     v=c.find('s:v',ns); value=v.text if v is not None and v.text else ''
     if c.get('t')=='s': value=strings[int(value)]
     elif c.get('t')=='inlineStr': value=''.join(t.text or '' for t in c.iter('{'+ns['s']+'}t'))
     emit(value,{'sheet':sheet.get('name','Sheet'),'row':int(m[2]),'column':col})
 elif fmt=='pdf':
  if not data.startswith(b'%PDF-'): fail('unsupported_content')
  import pypdf
  if pypdf.__version__!='6.18.1': fail('unsupported_content')
  from pypdf import PdfReader
  reader=PdfReader(io.BytesIO(data),strict=True)
  if reader.is_encrypted: fail('unsupported_content')
  if len(reader.pages)>300: fail('limit_exceeded')
  for i,page in enumerate(reader.pages,1):
   text=page.extract_text() or ''
   if not text.strip(): fail('ocr_required')
   paragraphs(text,{'page':i})
  if not fragments: fail('ocr_required')
 else: fail('unsupported_content')
 if not fragments: fail('unsupported_content')
 result={'output':{'fragments':fragments,'warnings':warnings}}
except Exception as e:
 code=str(e)
 result={'error':code if code in ('limit_exceeded','unsupported_content','ocr_required') else 'parse_failed'}
open(sys.argv[3],'w',encoding='utf-8').write(json.dumps(result,ensure_ascii=False))
`;
