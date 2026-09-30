/**
 * Reviewed image-to-entity matches. Every source URL is the file's own
 * Wikimedia Commons description page, including its author and reuse terms.
 * Logo copyright status does not waive trademark restrictions. Do not infer
 * an image from an entity name or substitute a site's favicon for its logo.
 */
export const extraResourceMedia: Readonly<
  Record<
    string,
    { url: string; sourceUrl: string; credit: string; license: string; kind: 'logo' | 'portrait' }
  >
> = {
  'company-anthropic': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/78/Anthropic_logo.svg/330px-Anthropic_logo.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Anthropic_logo.svg',
    credit: 'Anthropic',
    license: 'Commons：公有领域（简单文字标志）；商标权另论',
    kind: 'logo',
  },
  'company-meta': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7b/Meta_Platforms_Inc._logo.svg/330px-Meta_Platforms_Inc._logo.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Meta_Platforms_Inc._logo.svg',
    credit: 'Meta Platforms',
    license: 'Commons：公有领域（简单几何与文字）；商标权另论',
    kind: 'logo',
  },
  'company-amd': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7c/AMD_Logo.svg/330px-AMD_Logo.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:AMD_Logo.svg',
    credit: 'Advanced Micro Devices',
    license: 'Commons：公有领域（简单文字标志）；商标权另论',
    kind: 'logo',
  },
  'company-amazon': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/06/Amazon_2024.svg/330px-Amazon_2024.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Amazon_2024.svg',
    credit: 'Amazon',
    license: 'Commons：公有领域（简单文字标志）；商标权另论',
    kind: 'logo',
  },
  'company-sk-hynix': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/24/SK_Hynix.svg/330px-SK_Hynix.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:SK_Hynix.svg',
    credit: 'SK hynix',
    license: 'Commons：公有领域（简单文字标志）；商标权另论',
    kind: 'logo',
  },
  'company-samsung-electronics': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4e/Samsung_Electronics_logo_%28english%29.svg/330px-Samsung_Electronics_logo_%28english%29.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Samsung_Electronics_logo_(english).svg',
    credit: 'Samsung Electronics',
    license: 'Commons：公有领域（简单文字标志）；商标权另论',
    kind: 'logo',
  },
  'company-intel': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6a/Intel_logo_%282020%2C_dark_blue%29.svg/330px-Intel_logo_%282020%2C_dark_blue%29.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Intel_logo_(2020,_dark_blue).svg',
    credit: 'Intel',
    license: 'Commons：公有领域（简单文字标志）；商标权另论',
    kind: 'logo',
  },
  'company-broadcom': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/58/Broadcom_logo_%282016-present%29.svg/330px-Broadcom_logo_%282016-present%29.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Broadcom_logo_(2016-present).svg',
    credit: 'Broadcom',
    license: 'Commons：公有领域（简单文字标志）；商标权另论',
    kind: 'logo',
  },
  'company-qualcomm': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fc/Qualcomm-Logo.svg/330px-Qualcomm-Logo.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Qualcomm-Logo.svg',
    credit: 'Qualcomm',
    license: 'Commons：公有领域（简单文字标志）；商标权另论',
    kind: 'logo',
  },
  'company-waymo': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9f/Waymo_logo.svg/330px-Waymo_logo.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Waymo_logo.svg',
    credit: 'Waymo',
    license: 'Commons：公有领域（简单文字标志）；商标权另论',
    kind: 'logo',
  },
  'company-hugging-face': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d6/Hf-logo-with-title.svg/330px-Hf-logo-with-title.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Hf-logo-with-title.svg',
    credit: 'Victor（Hugging Face）',
    license: '图形 Apache-2.0；文字为简单文字标志',
    kind: 'logo',
  },
  'company-mediatek': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1a/MediaTek_Logo_wiki.svg/330px-MediaTek_Logo_wiki.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:MediaTek_Logo_wiki.svg',
    credit: 'MediaTek',
    license: 'Commons：公有领域（简单文字标志）；商标权另论',
    kind: 'logo',
  },
  'company-hut8': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ea/Hut_8_Logo.png/330px-Hut_8_Logo.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Hut_8_Logo.png',
    credit: 'Hut 8 Mining Corp',
    license: 'CC BY 4.0；Commons VRT 已确认许可',
    kind: 'logo',
  },
  'company-alphabet': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7a/Alphabet_Inc_Logo_2015.svg/330px-Alphabet_Inc_Logo_2015.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Alphabet_Inc_Logo_2015.svg',
    credit: 'Alphabet',
    license: 'Commons：公有领域（简单文字标志）；商标权另论',
    kind: 'logo',
  },
  'company-sk-telecom': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2d/SK_Telecom_Logo.svg/330px-SK_Telecom_Logo.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:SK_Telecom_Logo.svg',
    credit: 'SK Telecom',
    license: 'Commons：公有领域（简单文字标志）；商标权另论',
    kind: 'logo',
  },
  'institution-european-commission': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2f/Logo_of_the_European_Commission_%282025%2C_English%2C_horizontal%29.svg/330px-Logo_of_the_European_Commission_%282025%2C_English%2C_horizontal%29.svg.png',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Logo_of_the_European_Commission_(2025,_English,_horizontal).svg',
    credit: 'European Commission',
    license: 'Commons：欧盟委员会标识使用条款见来源页',
    kind: 'logo',
  },
  'institution-fsb': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f0/Financial_Stability_Board_logo.svg/330px-Financial_Stability_Board_logo.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Financial_Stability_Board_logo.svg',
    credit: 'Financial Stability Board',
    license: 'Commons：公有领域（简单文字标志）',
    kind: 'logo',
  },
  'institution-fcc': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/23/Seal_of_the_Federal_Communications_Commission.svg/330px-Seal_of_the_Federal_Communications_Commission.svg.png',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Seal_of_the_Federal_Communications_Commission.svg',
    credit: 'Federal Communications Commission',
    license: 'Commons：美国联邦政府作品；徽章使用限制见来源页',
    kind: 'logo',
  },
  'institution-white-house': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/db/White_House_Logo.png/330px-White_House_Logo.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:White_House_Logo.png',
    credit: 'The White House',
    license: '美国联邦政府作品，公有领域',
    kind: 'logo',
  },
  'institution-china-mofcom': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/16/MINISTRY_OF_COMMERCE%2CP.R.CHINA_badge.svg/330px-MINISTRY_OF_COMMERCE%2CP.R.CHINA_badge.svg.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:MINISTRY_OF_COMMERCE,P.R.CHINA_badge.svg',
    credit: '中华人民共和国商务部',
    license: 'Commons：简单几何图形，公有领域；官方徽记另有限制',
    kind: 'logo',
  },
  'institution-us-house': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1a/Seal_of_the_United_States_House_of_Representatives.svg/330px-Seal_of_the_United_States_House_of_Representatives.svg.png',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Seal_of_the_United_States_House_of_Representatives.svg',
    credit: 'U.S. House of Representatives',
    license: 'Commons：公有领域；官方徽章使用限制见来源页',
    kind: 'logo',
  },
  'person-sam-altman': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2f/Sam_Altman_speaking_at_TED_%28cropped%29.jpg/330px-Sam_Altman_speaking_at_TED_%28cropped%29.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Sam_Altman_speaking_at_TED_(cropped).jpg',
    credit: 'Steve Jurvetson；使用裁切版',
    license: 'CC BY 2.0',
    kind: 'portrait',
  },
  'person-mark-zuckerberg': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ef/Mark_Zuckerberg.jpg/330px-Mark_Zuckerberg.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Mark_Zuckerberg.jpg',
    credit: 'Eirik Solheim',
    license: 'CC BY-SA 2.0',
    kind: 'portrait',
  },
  'person-sundar-pichai': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c3/Sundar_Pichai_-_2023_%28cropped%29.jpg/330px-Sundar_Pichai_-_2023_%28cropped%29.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Sundar_Pichai_-_2023_(cropped).jpg',
    credit: 'Lukasz Kobus／European Commission；使用裁切版',
    license: 'CC BY 4.0',
    kind: 'portrait',
  },
  'person-andy-jassy': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/07/Andy_Jassy.jpg/330px-Andy_Jassy.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Andy_Jassy.jpg',
    credit: 'Lisi Mezistrano Wolf',
    license: 'CC BY-SA 4.0',
    kind: 'portrait',
  },
  'person-lip-bu-tan': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5b/Intel_CEO_Lip-Bu_Tan_%282025%29_%28cropped%29.jpg/330px-Intel_CEO_Lip-Bu_Tan_%282025%29_%28cropped%29.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Intel_CEO_Lip-Bu_Tan_(2025)_(cropped).jpg',
    credit: 'United States Department of Commerce；使用裁切版',
    license: '美国联邦政府作品，公有领域',
    kind: 'portrait',
  },
  'person-cristiano-amon': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/44/CristianoAmon.jpeg/330px-CristianoAmon.jpeg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:CristianoAmon.jpeg',
    credit: 'Eric Myer Photography, Inc.',
    license: 'CC BY-SA 3.0',
    kind: 'portrait',
  },
  'person-ted-lieu': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f9/Congressman_Ted_W._Lieu_Official_Photo.jpg/330px-Congressman_Ted_W._Lieu_Official_Photo.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Congressman_Ted_W._Lieu_Official_Photo.jpg',
    credit: 'U.S. House of Representatives',
    license: '美国联邦政府作品，公有领域',
    kind: 'portrait',
  },
  'person-michael-kratsios': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/25/Michael_Kratsios%2C_official_White_House_portrait%2C_2025.jpg/330px-Michael_Kratsios%2C_official_White_House_portrait%2C_2025.jpg',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Michael_Kratsios,_official_White_House_portrait,_2025.jpg',
    credit: 'The White House',
    license: '美国联邦政府作品，公有领域',
    kind: 'portrait',
  },
  'person-henna-virkkunen': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4d/Outdoor_portraits_of_Henna_Virkkunen%2C_Executive_Vice-President_of_the_EC_for_Tech_Sovereignty%2C_Security_and_Democracy_%28P-064862-00-06%29.jpg/330px-Outdoor_portraits_of_Henna_Virkkunen%2C_Executive_Vice-President_of_the_EC_for_Tech_Sovereignty%2C_Security_and_Democracy_%28P-064862-00-06%29.jpg',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Outdoor_portraits_of_Henna_Virkkunen,_Executive_Vice-President_of_the_EC_for_Tech_Sovereignty,_Security_and_Democracy_(P-064862-00-06).jpg',
    credit: 'Xavier Lejeune／European Commission',
    license: 'CC BY 4.0',
    kind: 'portrait',
  },
  'person-elon-musk': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d8/Elon_Musk_Royal_Society_%28cropped%29.jpg/330px-Elon_Musk_Royal_Society_%28cropped%29.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Elon_Musk_Royal_Society_(cropped).jpg',
    credit: 'Duncan.Hull／The Royal Society；使用裁切版',
    license: 'CC BY-SA 4.0；Commons VRT 已确认原图许可',
    kind: 'portrait',
  },
  'person-scott-bessent': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/72/Scott_Bessent%2C_official_portrait_%282025%29.jpg/330px-Scott_Bessent%2C_official_portrait_%282025%29.jpg',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Scott_Bessent,_official_portrait_(2025).jpg',
    credit: 'United States Department of the Treasury',
    license: '美国联邦政府作品，公有领域',
    kind: 'portrait',
  },
  'person-jakub-pachocki': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3d/Jakub_Pachocki_in_2012_%28with_hands_in_pockets%29.jpg/330px-Jakub_Pachocki_in_2012_%28with_hands_in_pockets%29.jpg',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Jakub_Pachocki_in_2012_(with_hands_in_pockets).jpg',
    credit: 'Bartosz Szreder／ICPCNews',
    license: 'CC BY 2.0；Commons 已核验 Flickr 授权',
    kind: 'portrait',
  },
  'person-lei-jun': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d7/Lei_Jun_%282026%29_01.jpg/330px-Lei_Jun_%282026%29_01.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Lei_Jun_(2026)_01.jpg',
    credit:
      'Ministry of the Presidency, Government of Spain；摄影 Borja Puig de la Bellacasa；2026-04-13；使用裁切版',
    license: '西班牙政府署名许可（来源及日期已注明）',
    kind: 'portrait',
  },
  'person-hock-tan': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c5/Hock_Tan_2022.png/330px-Hock_Tan_2022.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Hock_Tan_2022.png',
    credit: 'Greg Bezat／Broadcom',
    license: 'CC BY-SA 4.0；Commons VRT 已确认授权',
    kind: 'portrait',
  },
  'person-chey-tae-won': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/58/Chey_Tae-won_20241217.jpg/330px-Chey_Tae-won_20241217.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Chey_Tae-won_20241217.jpg',
    credit: '韩国国会，2024-12-17',
    license: 'Korea Open Government License Type 1（须注明来源）',
    kind: 'portrait',
  },
  'person-andrew-bailey': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/5/52/Andrew_Bailey_%28cropped%29.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Andrew_Bailey_(cropped).jpg',
    credit: 'UK Government；使用裁切版',
    license: 'UK Open Government Licence v3.0',
    kind: 'portrait',
  },
  'person-aidan-gomez': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/46/Aidan_Gomez_at_%22ALL_IN%22_2025_06.jpg/330px-Aidan_Gomez_at_%22ALL_IN%22_2025_06.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Aidan_Gomez_at_%22ALL_IN%22_2025_06.jpg',
    credit: 'Gabriel Hutchinson',
    license: 'CC BY-SA 4.0',
    kind: 'portrait',
  },
  'person-karsten-wildberger': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fe/Karsten_Wildberger_at_Republica25_2025-05-27_02.jpg/330px-Karsten_Wildberger_at_Republica25_2025-05-27_02.jpg',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Karsten_Wildberger_at_Republica25_2025-05-27_02.jpg',
    credit: 'Leonhard Lenz',
    license: 'CC BY 4.0',
    kind: 'portrait',
  },
  'person-sebastien-bubeck': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/66/Sebastien_Bubeck_CHM_Mountain_View_March_2025.jpg/330px-Sebastien_Bubeck_CHM_Mountain_View_March_2025.jpg',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Sebastien_Bubeck_CHM_Mountain_View_March_2025.jpg',
    credit: 'King of Hearts',
    license: 'CC BY-SA 4.0',
    kind: 'portrait',
  },
  'person-amy-hood': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/8b/Amy_Hood.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Amy_Hood.jpg',
    credit: 'The White House；裁切：Berita',
    license: '美国联邦政府作品，公有领域',
    kind: 'portrait',
  },
  'person-klaus-mueller': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b5/Klasu_M%C3%BCller%2C_Pr%C3%A4sident_der_Bundesnetzagentur_2022.jpg/330px-Klasu_M%C3%BCller%2C_Pr%C3%A4sident_der_Bundesnetzagentur_2022.jpg',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Klasu_M%C3%BCller,_Pr%C3%A4sident_der_Bundesnetzagentur_2022.jpg',
    credit: '德国联邦网络局（BNetzA）／Christian Nemitz',
    license: 'CC BY-SA 4.0',
    kind: 'portrait',
  },
  'person-nathaniel-moran': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fd/Nathaniel_Moran%2C_official_portrait%2C_118th_Congress_%28cropped%29.jpg/330px-Nathaniel_Moran%2C_official_portrait%2C_118th_Congress_%28cropped%29.jpg',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Nathaniel_Moran,_official_portrait,_118th_Congress_(cropped).jpg',
    credit: 'United States Congress；使用裁切版',
    license: '美国联邦政府作品，公有领域',
    kind: 'portrait',
  },
  'person-llion-jones': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e9/Llion_Jones%2C_author_of_Attention_is_All_You_Need%2C_at_CIC_Tokyo_speaking_about_sakana.ai_%28cropped%29.jpg/330px-Llion_Jones%2C_author_of_Attention_is_All_You_Need%2C_at_CIC_Tokyo_speaking_about_sakana.ai_%28cropped%29.jpg',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Llion_Jones,_author_of_Attention_is_All_You_Need,_at_CIC_Tokyo_speaking_about_sakana.ai_(cropped).jpg',
    credit: 'Syced；使用裁切版',
    license: 'CC0 1.0',
    kind: 'portrait',
  },
};
