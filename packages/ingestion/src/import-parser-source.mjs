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
def emit(text,locator):
 global total
 text=text.strip()
 if not text: return
 if '\x00' in text or len(text)>20000: fail('limit_exceeded')
 total+=len(text.encode('utf-8'))
 if total>1000000 or len(fragments)>=10000: fail('limit_exceeded')
 fragments.append({'text':text,'locator':locator})
def paragraphs(text):
 for i,p in enumerate(re.split(r'\n\s*\n',text),1): emit(p,{'paragraph':i})
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
 def __init__(self): super().__init__(convert_charrefs=True); self.skip=0; self.parts=[]
 def handle_starttag(self,tag,attrs):
  if tag in ('script','style','noscript','template'): self.skip+=1
  if tag in ('p','div','br','h1','h2','h3','li','tr'): self.parts.append('\n\n')
 def handle_endtag(self,tag):
  if tag in ('script','style','noscript','template') and self.skip: self.skip-=1
 def handle_data(self,data):
  if not self.skip: self.parts.append(data)
try:
 data=open(sys.argv[1],'rb').read(25*1024*1024+1); fmt=sys.argv[2]
 if not data or len(data)>25*1024*1024: fail('limit_exceeded')
 if fmt in ('text','markdown','html','csv'):
  if data.startswith((b'%PDF-',b'PK\x03\x04',b'\x89PNG',b'\xff\xd8')): fail('unsupported_content')
  text=data.decode('utf-8-sig',errors='strict')
  if fmt=='html':
   p=HTMLText(); p.feed(text); paragraphs(''.join(p.parts))
  elif fmt=='csv':
   csv.field_size_limit(20000)
   for row,values in enumerate(csv.reader(io.StringIO(text)),1):
    if row>1000000: fail('limit_exceeded')
    for col,value in enumerate(values,1): emit(value,{'row':row,'column':col})
  else: paragraphs(text)
 elif fmt=='docx':
  z=archive(data); root=xml(z.read('word/document.xml'))
  for i,p in enumerate(root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'),1):
   emit(''.join(t.text or '' for t in p.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')),{'paragraph':i})
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
   emit(text,{'page':i})
  if not fragments: fail('ocr_required')
 else: fail('unsupported_content')
 if not fragments: fail('unsupported_content')
 result={'output':{'fragments':fragments,'warnings':warnings}}
except Exception as e:
 code=str(e)
 result={'error':code if code in ('limit_exceeded','unsupported_content','ocr_required') else 'parse_failed'}
open(sys.argv[3],'w',encoding='utf-8').write(json.dumps(result,ensure_ascii=False))
`;
