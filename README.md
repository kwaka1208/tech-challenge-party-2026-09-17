# tech-challenge-party-2026-09-17

## あの日の空 — Birthday Sky

生年月日・時刻・観測地点から、その瞬間の星空と観測環境を再現するWebアプリです。天体配置に加え、過去天候、衛星夜間光による光害、周辺標高による地形遮蔽を推定して表示へ反映します。

### 主な機能

- 生年月日と時刻を指定
- 都市名・地名検索、現在地取得、緯度経度の手動入力
- 観測地点のIANAタイムゾーンを自動判定
- NASA/HEASARC Bright Star Catalog由来の8,132レコードを主要恒星59星と重複排除して表示
- 1.0〜6.5等級の表示上限を0.5刻みで選択
- 恒星のJ2000座標に歳差補正を適用
- 太陽、月、水星〜土星と9星座を全天星図に表示
- 薄明、月明かり、過去の雲量・湿度・降水、光害による肉眼限界を反映
- Copernicus DEM GLO-90から方位別の地平線を生成し、地形に隠れる天体を除外
- 星空部分のフルスクリーン表示
- 星座線、天体名、太陽・月・惑星の個別表示切り替え
- ドラッグによる方角変更、ホイール／ボタンによる拡大縮小
- 各環境データの取得状態、出典、解像度、年代外フォールバックを表示
- 1サービスの失敗で星図全体を停止しない部分障害対応
- PC・モバイル対応

### セットアップ

Node.js 22以降を推奨します。

```bash
npm install
npm run dev
```

表示されたローカルURLをブラウザで開いてください。現在地取得とフルスクリーン表示は対応ブラウザの`localhost`またはHTTPS環境で利用できます。環境データの取得にはインターネット接続が必要です。

### コマンド

```bash
npm run dev         # 開発サーバー
npm run typecheck   # TypeScript型チェック
npm run build       # 本番ビルド
npm run preview     # ビルド結果のプレビュー
npm run data:stars  # NASA/HEASARCから恒星データを再生成
```

通常の起動・ビルドではネットワークから星表を取得しません。生成済みデータをアプリへ同梱しています。

### GitHub Pagesへのデプロイ

公開先は次のURLです。

- `https://kwaka1208.github.io/tech-challenge-party-2026-09-17/`

初回のみ、GitHubリポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定してください。その後は`main`ブランチへのpushで`.github/workflows/deploy-pages.yml`がビルドとデプロイを自動実行します。GitHubの **Actions → Deploy to GitHub Pages → Run workflow** から手動実行することもできます。

Viteの`base`は現在のリポジトリ名`tech-challenge-party-2026-09-17`に合わせています。リポジトリ名または公開先を変更する場合は`vite.config.ts`の`base`も更新してください。

### 使用技術・データ

- React 19 / TypeScript / Vite
- [NASA HEASARC Bright Star Catalog](https://heasarc.gsfc.nasa.gov/W3Browse/all/bsc5p.html) — J2000位置、V等級、B−V色指数
- [Astronomy Engine](https://github.com/cosinekitty/astronomy) — 太陽系天体の位置・月相・座標変換
- [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) — 過去天候の再解析値
- [NASA Black Marble / GIBS](https://www.earthdata.nasa.gov/data/projects/black-marble) — VIIRS夜間光放射輝度
- [Open-Meteo Elevation API](https://open-meteo.com/en/docs/elevation-api) — Copernicus DEM GLO-90標高
- Canvas 2D — 全天星図、雲・光害・地形シルエット描画
- [OpenStreetMap Nominatim](https://nominatim.org/) — 地名検索・逆ジオコーディング
- [TimeAPI](https://timeapi.io/) — 座標からIANAタイムゾーンを取得
- Browser Geolocation / Fullscreen API

### データと精度

NASA HEASARCで公開されているBright Star Catalog 5th Edition Preliminaryのうち、3.45より暗く6.5等級以下の8,132星を同梱しています。主要恒星59星を名称付きデータとして補完し、恒星位置にはIAU 1976歳差モデルを適用します。太陽系天体にはAstronomy Engineの光行差・視差・歳差・章動を考慮した座標を使用しています。

実際の表示上限は、ユーザーが選択した最大等級、太陽高度・月明かりによる自然限界、過去天候、光害相当値の最小値です。環境APIが利用できない場合、その要素を制約から外し、晴天・暗空とは断定しません。

#### 過去天候

Open-Meteoの再解析データを1時間単位で使用します。1940年以降が対象で、未来および直近5日間は対象外です。値は観測所、衛星、数値モデル等を統合した推定であり、指定地点での実測ではありません。空間解像度は地点・年代により約9〜25 kmです。

#### 光害

NASA GIBSの`VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance`をWMSで取得し、約500 mの日次放射輝度からBortle階級相当と限界等級を概算します。対象は2012-01-19以降です。2012年以前、未来、または指定日の画像がない場合は2016-01-01の値を代替使用し、画面上で「推定」と参照日を明示します。これは当時の街灯環境を正確に復元するものではありません。

#### 地形

Open-Meteo Elevation APIのCopernicus DEM GLO-90（約90 m）を使用します。10°ごとの方位で0.25〜50 km先を標本化し、地球曲率と標準的な大気屈折を考慮して最大仰角を計算します。建物、樹木、造成前後の地形などは含みません。

入力できる日付は1900年から2100年です。夏時間開始時に存在しない現地時刻はエラーになり、夏時間終了時に同じ時刻が2回現れる場合は最初の時刻を採用します。

地名検索、タイムゾーン判定、環境データ、Webフォントにはインターネット接続が必要です。天体位置の計算と同梱星表の表示はブラウザ内で行います。
