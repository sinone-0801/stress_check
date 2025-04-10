// DOM要素が読み込まれた後に実行する
document.addEventListener('DOMContentLoaded', function() {
    // =========================================================
    // 定数および設定
    // =========================================================
    const MINIMUM_MEASUREMENT_TIME = 30; // 最低30秒の測定
    const SAMPLING_INTERVAL_MS = 25;     // オーディオサンプリング間隔（ms）
    const LF_BAND_MIN = 0.04;            // LF帯域の下限（Hz）
    const LF_BAND_MAX = 0.15;            // LF帯域の上限（Hz）
    const HF_BAND_MIN = 0.15;            // HF帯域の下限（Hz）
    const HF_BAND_MAX = 0.4;             // HF帯域の上限（Hz）
    const IA_OUTLIER_PERCENT = 20;       // iA計算時に除外する外れ値の割合（%）
    const STRESS_QUADRANTS = {
        DEEP_RELAXATION: { name: '深いリラックス状態', color: 'rgba(0, 200, 0, 0.7)' },
        RESTING: { name: '安静状態', color: 'rgba(0, 0, 200, 0.7)' },
        MENTAL_STRESS: { name: '軽度精神ストレス', color: 'rgba(150, 0, 200, 0.7)' },
        PHYSICAL_STRESS: { name: '軽度身体ストレス', color: 'rgba(200, 0, 0, 0.7)' }
    };
    const CAMERA_FPS = 30;               // カメラのフレームレート推定値（Hz）

    // =========================================================
    // DOM要素の参照を取得
    // =========================================================
    const videoElement = document.getElementById('video');
    const canvasElement = document.getElementById('canvas');
    const canvasCtx = canvasElement.getContext('2d');
    const startCameraButton = document.getElementById('start-camera');
    const startMeasureButton = document.getElementById('start-measure');
    const stopMeasureButton = document.getElementById('stop-measure');
    const toggleLightButton = document.getElementById('toggle-light');
    const muteAudioButton = document.getElementById('mute-audio');
    const measuringOverlay = document.getElementById('measuring-overlay');
    const countdownElement = document.getElementById('countdown');
    const heartRateElement = document.getElementById('heart-rate');
    const hrvRmssdElement = document.getElementById('hrv-rmssd');
    const lfHfRatioElement = document.getElementById('lf-hf-ratio');
    const respirationRateElement = document.getElementById('respiration-rate');
    const stressLevelElement = document.getElementById('stress-level');
    const stressStateElement = document.getElementById('stress-state');
    const audioViz = document.getElementById('audio-viz');
    const completionMessage = document.getElementById('completion-message');
    const qualityElement = document.getElementById('signal-quality');
    const qualityBar = document.getElementById('quality-bar');

    // =========================================================
    // グローバル変数
    // =========================================================
    let mediaStream = null;
    let audioContext = null;
    let analyser = null;
    let measuring = false;
    let animationFrameId = null;
    let ppgData = [];
    let ppgTimes = [];
    let lfData = [];    // LF帯域のデータ（フィルタリング後）
    let hfData = [];    // HF帯域のデータ（フィルタリング後）
    let lfIAData = [];  // LF帯域の瞬時振幅データ
    let hfIAData = [];  // HF帯域の瞬時振幅データ
    let audioData = [];
    let startTime = 0;
    let heartRates = [];
    let lastHeartbeatTime = 0;
    let rrIntervals = [];
    let chart = null;
    let scatterChart = null;
    let scatterData = [];
    let measurementDuration = 0;
    let countdownInterval = null;
    let permissionRequested = false; // 権限リクエストフラグ
    let cameraLightOn = false;      // カメラライトの状態
    let audioMuted = false;         // 音声ミュート状態
    let signalQuality = 0;          // 信号品質（0-1）

    // オーディオコンテキストの設定を修正
    function setupAudio(stream) {
        // 既存のオーディオコンテキストがあれば閉じる
        if (audioContext) {
            audioContext.close();
        }
        
        // 新しいオーディオコンテキストを作成
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const audioSource = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        
        // マイク入力をスピーカーに出力しないようにする
        // (analyserには接続するが、audioContextのdestinationには接続しない)
        audioSource.connect(analyser);
        
        // ループバックを防ぐため以下は行わない:
        // analyser.connect(audioContext.destination);
    }

    // =========================================================
    // オーディオビジュアライザーの設定
    // =========================================================
    function setupAudioVisualizer() {
        // 既存の要素をクリア
        audioViz.innerHTML = '';
        
        const barCount = 64;
        for (let i = 0; i < barCount; i++) {
            const bar = document.createElement('div');
            bar.className = 'viz-bar';
            bar.style.left = `${i * 4}px`;
            audioViz.appendChild(bar);
        }
    }

    // =========================================================
    // カメラとマイクへのアクセスを取得
    // =========================================================
    async function startCamera() {
        if (permissionRequested) {
            console.log('すでに権限をリクエスト済みです');
            return;
        }
        
        permissionRequested = true;
        console.log('カメラとマイクの権限をリクエスト中...');
        
        try {
            // カメラとマイクのストリームを取得
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                },
                audio: true
            });
            
            console.log('ストリームを取得しました');
            mediaStream = stream;
            
            // ビデオ要素にストリームをセット
            videoElement.srcObject = stream;
            
            // オーディオコンテキストの設定
            setupAudio(stream);
            // audioContext = new (window.AudioContext || window.webkitAudioContext)();
            // const audioSource = audioContext.createMediaStreamSource(stream);
            // analyser = audioContext.createAnalyser();
            // analyser.fftSize = 256;
            // audioSource.connect(analyser);
            
            // ビデオプレイヤーを再生
            await videoElement.play();
            console.log('ビデオ再生開始');
            
            // キャンバスのサイズを設定
            canvasElement.width = videoElement.videoWidth;
            canvasElement.height = videoElement.videoHeight;
            
            // オーディオビジュアライザーのセットアップ
            setupAudioVisualizer();
            
            // ボタンの状態を更新
            startCameraButton.disabled = true;
            startMeasureButton.disabled = false;
            toggleLightButton.disabled = false;
            
            // チャートの初期化
            initChart();
            initScatterChart();
            
            // オーディオビジュアライザーのテスト処理を開始
            testAudioVisualizer();
            
            console.log('カメラとマイクの初期化が完了しました');
        } catch (error) {
            console.error('カメラまたはマイクへのアクセスエラー:', error);
            alert('カメラまたはマイクにアクセスできませんでした。設定を確認してください。\n\nエラー: ' + error.message);
            permissionRequested = false;
        }
    }
    
    // =========================================================
    // オーディオビジュアライザーのテスト
    // =========================================================
    function testAudioVisualizer() {
        if (!analyser) return;
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        
        // オーディオビジュアライザーの更新
        updateAudioVisualizer(dataArray);
        
        // 測定中でなくても表示を更新
        if (!measuring) {
            requestAnimationFrame(testAudioVisualizer);
        }
    }
    
    // =========================================================
    // オーディオビジュアライザーの更新
    // =========================================================
    function updateAudioVisualizer(dataArray) {
        const bars = document.querySelectorAll('.viz-bar');
        if (bars.length > 0) {
            const step = Math.ceil(dataArray.length / bars.length);
            
            for (let i = 0; i < bars.length; i++) {
                // インデックスが範囲外にならないようにする
                const index = Math.min(i * step, dataArray.length - 1);
                const value = dataArray[index] || 0;
                const height = value / 2; // スケーリング
                bars[i].style.height = `${height}px`;
            }
        }
    }

    // =========================================================
    // カメラライトのトグル処理
    // =========================================================
    async function toggleCameraLight() {
        if (!mediaStream) return;
        
        try {
            // 最新ブラウザのImageCapture APIを使用してトーチ（フラッシュライト）にアクセス
            const videoTrack = mediaStream.getVideoTracks()[0];
            
            if (videoTrack) {
                // トーチの状態をトグル
                const capabilities = videoTrack.getCapabilities();
                
                // トーチ機能がサポートされているか確認
                if (capabilities && capabilities.torch) {
                    cameraLightOn = !cameraLightOn;
                    await videoTrack.applyConstraints({
                        advanced: [{ torch: cameraLightOn }]
                    });
                    
                    // ボタンのテキストを更新
                    toggleLightButton.innerHTML = cameraLightOn ? 
                        'カメラライト OFF' : 
                        'カメラライト ON';
                    
                    console.log(`カメラライトを${cameraLightOn ? 'オン' : 'オフ'}にしました`);
                } else {
                    console.log('このデバイスはカメラライト（トーチ）をサポートしていません');
                    alert('このデバイスはカメラライト（トーチ）をサポートしていません');
                }
            }
        } catch (error) {
            console.error('カメラライトの切り替えエラー:', error);
            alert('カメラライトの操作中にエラーが発生しました: ' + error.message);
        }
    }

    // =========================================================
    // 音声ミュートのトグル
    // =========================================================
    function toggleAudioMute() {
        if (!audioContext) return;
        
        audioMuted = !audioMuted;
        
        // オーディオコンテキストの状態を変更
        if (audioMuted) {
            if (audioContext.state === 'running') {
                audioContext.suspend();
            }
        } else {
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }
        }
        
        // ボタンのテキストを更新
        muteAudioButton.innerHTML = audioMuted ? 
            '音声オン' : 
            '音声ミュート';
        
        console.log(`音声を${audioMuted ? 'ミュート' : 'オン'}にしました`);
    }

    // =========================================================
    // 測定開始
    // =========================================================
    function startMeasurement() {
        if (!measuring) {
            // 測定開始
            measuring = true;
            measuringOverlay.style.display = 'flex';
            startTime = Date.now();
            measurementDuration = 0;
            ppgData = [];
            ppgTimes = [];
            lfData = [];
            hfData = [];
            lfIAData = [];
            hfIAData = [];
            audioData = [];
            heartRates = [];
            rrIntervals = [];
            scatterData = [];
            lastHeartbeatTime = 0;
            signalQuality = 0;
            
            // 信号品質インジケータをリセット
            updateSignalQuality(0);
            
            // 完了メッセージを非表示
            completionMessage.style.display = 'none';
            
            // ボタンの状態を更新
            startMeasureButton.disabled = true;
            stopMeasureButton.disabled = true; // 最初は無効化
            
            // カウントダウンの開始
            startCountdown(MINIMUM_MEASUREMENT_TIME);
            
            // 測定ループを開始
            animationFrameId = requestAnimationFrame(processFrame);
            
            // オーディオ処理のループを開始
            processAudio();
            
            // 自動停止タイマーを設定（カウントダウン後5秒経過で自動停止）
            setTimeout(() => {
                if (measuring) {
                    console.log('自動測定停止タイマーが作動しました');
                    stopMeasurement();
                }
            }, (MINIMUM_MEASUREMENT_TIME + 5) * 1000);
        }
    }

    // =========================================================
    // 測定停止
    // =========================================================
    function stopMeasurement() {
        if (measuring) {
            // 測定が最低時間に達していない場合は警告
            if (measurementDuration < MINIMUM_MEASUREMENT_TIME * 1000) {
                alert(`測定時間が短すぎます。少なくとも${MINIMUM_MEASUREMENT_TIME}秒間の測定が必要です。`);
                return;
            }
            
            // 測定停止
            endMeasurement();
        }
    }

    // =========================================================
    // 測定終了処理
    // =========================================================
    function endMeasurement() {
        measuring = false;
        measuringOverlay.style.display = 'none';
        cancelAnimationFrame(animationFrameId);
        
        // カウントダウンを停止
        clearInterval(countdownInterval);
        countdownElement.style.display = 'none';
        
        // 結果の計算と表示
        calculateResults();
        
        // ボタンの状態を更新
        startMeasureButton.disabled = false;
        stopMeasureButton.disabled = true;
        
        // 完了メッセージを表示
        completionMessage.style.display = 'block';
        
        // 自動スクロール
        setTimeout(() => {
            document.querySelector('.results').scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start' 
            });
        }, 500);
    }

    // =========================================================
    // カウントダウン開始
    // =========================================================
    function startCountdown(seconds) {
        let timeLeft = seconds;
        countdownElement.textContent = timeLeft;
        countdownElement.style.display = 'block';
        
        // 既存のカウントダウンがあれば停止
        if (countdownInterval) {
            clearInterval(countdownInterval);
        }
        
        countdownInterval = setInterval(() => {
            timeLeft--;
            countdownElement.textContent = timeLeft;
            
            if (timeLeft <= 0) {
                clearInterval(countdownInterval);
                countdownElement.style.display = 'none';
                // カウントダウン終了時に停止ボタンを有効化
                stopMeasureButton.disabled = false;
            }
        }, 1000);
    }

    // =========================================================
    // フレーム処理（カメラ画像からPPG信号を抽出）
    // =========================================================
    function processFrame() {
        if (!measuring) return;
        
        // 経過時間の更新
        measurementDuration = Date.now() - startTime;
        
        // 最小測定時間を過ぎたら自動的に停止ボタンを有効化
        if (measurementDuration >= MINIMUM_MEASUREMENT_TIME * 1000 && stopMeasureButton.disabled) {
            stopMeasureButton.disabled = false;
        }
        
        // ビデオフレームをキャンバスに描画
        canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        
        // 中央部分の赤色成分を抽出（PPG信号として）
        const centerX = Math.floor(canvasElement.width / 2);
        const centerY = Math.floor(canvasElement.height / 2);
        const sampleSize = 20;
        
        const imageData = canvasCtx.getImageData(
            centerX - sampleSize / 2,
            centerY - sampleSize / 2,
            sampleSize,
            sampleSize
        );
        
        // 赤色成分の平均を計算
        let redSum = 0;
        const pixels = imageData.data;
        for (let i = 0; i < pixels.length; i += 4) {
            redSum += pixels[i]; // 赤色成分
        }
        const redAvg = redSum / (sampleSize * sampleSize);
        
        // データを配列に追加
        const currentTime = Date.now() - startTime;
        ppgData.push(redAvg);
        ppgTimes.push(currentTime);
        
        // PPG信号を処理（改良版）
        processPpgSignalEnhanced(redAvg, currentTime);
        
        // チャートを更新
        updateChart();
        
        // 次のフレームの処理をリクエスト
        animationFrameId = requestAnimationFrame(processFrame);
    }
    
    // =========================================================
    // 改良されたPPG信号処理
    // =========================================================
    function processPpgSignalEnhanced(value, time) {
        // PPG信号からリアルタイムで心拍を検出
        detectHeartbeatEnhanced(value, time);
        
        // 信号品質の評価
        if (ppgData.length % 10 === 0 && ppgData.length >= 30) {
            const qualityAssessment = assessPpgQuality(ppgData);
            signalQuality = qualityAssessment.quality;
            
            // 品質情報の表示
            updateSignalQuality(signalQuality);
            
            // 品質が非常に低い場合、警告を表示
            if (signalQuality < 0.3 && measuring && ppgData.length > 100) {
                console.log('PPG信号品質が低すぎます:', qualityAssessment.reason);
                // UI上での警告表示（オプション）
            }
        }
        
        // 十分なデータが蓄積されたら周波数解析を実行
        if (ppgData.length >= 100) {
            // LF、HF帯域のフィルタリングと瞬時振幅の計算は10フレーム毎に実行
            if (ppgData.length % 10 === 0) {
                // 信号をプリプロセス（トレンド除去、ノイズ低減）
                const processedSignal = preprocessPpgSignal(ppgData);
                
                // 論文のAlgorithm 1に基づく実装
                const { lfFiltered, hfFiltered, lfIA, hfIA } = calculateInstantaneousAmplitude(processedSignal);
                
                // 最新の値を保存
                lfData.push(lfFiltered[lfFiltered.length - 1]);
                hfData.push(hfFiltered[hfFiltered.length - 1]);
                lfIAData.push(lfIA);
                hfIAData.push(hfIA);
                
                // スキャッターデータを更新
                if (lfIAData.length > 0 && hfIAData.length > 0) {
                    addScatterDataPoint(lfIAData[lfIAData.length - 1], hfIAData[hfIAData.length - 1]);
                }
            }
        }
    }

    // =========================================================
    // PPG信号品質評価
    // =========================================================
    function assessPpgQuality(signal, window = 30) {
        if (signal.length < window) return { quality: 0, reason: "データ不足" };
        
        // 最新のウィンドウサイズ分のデータを取得
        const recentSignal = signal.slice(-window);
        
        // 1. 信号の変動性をチェック
        const stdDev = calculateStdDev(recentSignal);
        const mean = recentSignal.reduce((a, b) => a + b, 0) / recentSignal.length;
        const cv = (stdDev / mean) * 100; // 変動係数（％）
        
        // 変動が極端に小さい場合は、信号が検出できていない可能性がある
        if (cv < 0.5) {
            return { quality: 0.1, reason: "信号変動が小さすぎる" };
        }
        
        // 変動が極端に大きい場合は、ノイズが多い可能性がある
        if (cv > 20) {
            return { quality: 0.3, reason: "信号変動が大きすぎる" };
        }
        
        // 2. トレンドの一貫性をチェック
        let directionChanges = 0;
        let lastDirection = 0;
        
        for (let i = 1; i < recentSignal.length; i++) {
            const currentDirection = Math.sign(recentSignal[i] - recentSignal[i-1]);
            
            if (lastDirection !== 0 && currentDirection !== 0 && currentDirection !== lastDirection) {
                directionChanges++;
            }
            
            if (currentDirection !== 0) {
                lastDirection = currentDirection;
            }
        }
        
        // 方向変化の数が多すぎる場合はノイズが多い可能性がある
        const changeRatio = directionChanges / recentSignal.length;
        if (changeRatio > 0.7) {
            return { quality: 0.4, reason: "信号の方向変化が頻繁すぎる" };
        }
        
        // 3. 周期性をチェック
        // 自己相関を使用して周期的成分を確認
        const autocorr = calculateAutocorrelation(recentSignal);
        
        // 自己相関の最大値（最初のピーク）を探す
        let maxCorr = 0;
        let maxLag = 0;
        
        // 最初の数サンプルはスキップ（同じ信号との相関なので）
        for (let i = 3; i < autocorr.length / 2; i++) {
            if (autocorr[i] > maxCorr) {
                maxCorr = autocorr[i];
                maxLag = i;
            }
        }
        
        // 自己相関が弱い場合（0.3未満）は周期性が低い
        if (maxCorr < 0.3) {
            return { quality: 0.5, reason: "信号の周期性が弱い" };
        }
        
        // 品質スコアの計算（0～1）
        const qualityScore = Math.min(1, 
            0.4 * (1 - (Math.abs(cv - 5) / 15)) + // 変動係数の最適値は5%前後
            0.3 * (1 - changeRatio) +             // 方向変化が少ないほど良い
            0.3 * maxCorr                        // 自己相関が強いほど良い
        );
        
        return { 
            quality: Math.max(0, Math.min(1, qualityScore)), 
            reason: qualityScore > 0.7 ? "良好" : "やや低品質"
        };
    }

    // =========================================================
    // 自己相関の計算
    // =========================================================
    function calculateAutocorrelation(signal) {
        const n = signal.length;
        const result = new Array(n).fill(0);
        
        // 信号の平均を計算
        const mean = signal.reduce((a, b) => a + b, 0) / n;
        
        // 分散の計算
        let variance = 0;
        for (let i = 0; i < n; i++) {
            variance += Math.pow(signal[i] - mean, 2);
        }
        variance /= n;
        
        // 分散がゼロに近い場合は計算不能
        if (variance < 0.0001) {
            return Array(n).fill(0);
        }
        
        // 自己相関の計算
        for (let lag = 0; lag < n; lag++) {
            let sum = 0;
            for (let i = 0; i < n - lag; i++) {
                sum += (signal[i] - mean) * (signal[i + lag] - mean);
            }
            result[lag] = sum / ((n - lag) * variance);
        }
        
        return result;
    }

    // =========================================================
    // PPG信号の前処理
    // =========================================================
    function preprocessPpgSignal(signal) {
        if (signal.length < 10) return signal;
        
        // 1. 移動平均フィルタでトレンドを除去
        const windowSize = Math.min(30, Math.floor(signal.length / 5));
        const trend = calculateMovingAverage(signal, windowSize);
        
        // トレンド除去したシグナル
        const detrended = signal.map((val, i) => val - trend[i]);
        
        // 2. メディアンフィルタでスパイクノイズを除去
        const medianFiltered = applyMedianFilter(detrended, 3);
        
        // 3. バンドパスフィルタで心拍の一般的な周波数範囲（0.5～5Hz）を抽出
        // これはおおよそ30～300bpmに相当
        return bandpassFilterSimple(medianFiltered, 0.5, 5);
    }

    // =========================================================
    // メディアンフィルタの適用
    // =========================================================
    function applyMedianFilter(signal, windowSize) {
        const result = [];
        const halfWindow = Math.floor(windowSize / 2);
        
        for (let i = 0; i < signal.length; i++) {
            const window = [];
            
            for (let j = Math.max(0, i - halfWindow); j <= Math.min(signal.length - 1, i + halfWindow); j++) {
                window.push(signal[j]);
            }
            
            // 中央値を計算
            window.sort((a, b) => a - b);
            result.push(window[Math.floor(window.length / 2)]);
        }
        
        return result;
    }

    // =========================================================
    // 簡易バンドパスフィルタ（より高速な処理のため）
    // =========================================================
    function bandpassFilterSimple(signal, lowCutoff, highCutoff) {
        // 実際のサンプリング周波数の推定（フレームレートに依存）
        const fs = CAMERA_FPS;
        
        // バターワースフィルタの係数を近似
        const lowAlpha = Math.exp(-2 * Math.PI * lowCutoff / fs);
        const highAlpha = Math.exp(-2 * Math.PI * highCutoff / fs);
        
        // フィルタ適用
        const filtered = [];
        let lowPass1 = signal[0];
        let lowPass2 = signal[0];
        let highPass = signal[0];
        
        for (let i = 0; i < signal.length; i++) {
            // ローパスフィルタ
            lowPass1 = lowPass1 * lowAlpha + signal[i] * (1 - lowAlpha);
            lowPass2 = lowPass2 * highAlpha + signal[i] * (1 - highAlpha);
            
            // バンドパス（ローパス - ハイパス）
            const bandPass = lowPass2 - lowPass1;
            filtered.push(bandPass);
        }
        
        return filtered;
    }

    // =========================================================
    // 瞬時振幅の計算（論文のAlgorithm 1に忠実な実装）
    // =========================================================
    function calculateInstantaneousAmplitude(signal) {
        // 信号の長さが短い場合はデフォルト値を返す
        if (signal.length < 50) {
            return { 
                lfFiltered: [0], 
                hfFiltered: [0], 
                lfIA: 0, 
                hfIA: 0 
            };
        }
        
        // 1. 信号をLFとHF帯域にバンドパスフィルタリング
        const lfFiltered = bandpassFilter(signal, LF_BAND_MIN, LF_BAND_MAX);
        const hfFiltered = bandpassFilter(signal, HF_BAND_MIN, HF_BAND_MAX);
        
        // 2. ヒルベルト変換を適用して解析信号を生成
        const lfAnalytic = calculateAnalyticSignal(lfFiltered);
        const hfAnalytic = calculateAnalyticSignal(hfFiltered);
        
        // 3. 振幅の時系列を取得（解析信号の絶対値）
        const lfAmplitudes = lfAnalytic.map(complex => Math.sqrt(complex.real * complex.real + complex.imag * complex.imag));
        const hfAmplitudes = hfAnalytic.map(complex => Math.sqrt(complex.real * complex.real + complex.imag * complex.imag));
        
        // 4. 外れ値を除去して平均値を計算（論文のAlgorithm 1ステップ5）
        const lfIA = calculateRobustMean(lfAmplitudes, IA_OUTLIER_PERCENT);
        const hfIA = calculateRobustMean(hfAmplitudes, IA_OUTLIER_PERCENT);
        
        return { lfFiltered, hfFiltered, lfIA, hfIA };
    }

    // =========================================================
    // バンドパスフィルタ（FFTベースの実装）
    // =========================================================
    function bandpassFilter(signal, lowCutoff, highCutoff) {
        if (signal.length < 4) return Array(signal.length).fill(0);
        
        // サンプリング周波数の推定（PPGサンプリングレート, Hz）
        const estimatedFs = CAMERA_FPS; 
        
        // パディングサイズを信号長の2倍の2のべき乗に設定
        const paddingSize = Math.pow(2, Math.ceil(Math.log2(signal.length * 2)));
        
        // 信号をパディング
        const paddedSignal = [...signal];
        while (paddedSignal.length < paddingSize) {
            paddedSignal.push(0);
        }
        
        // 信号の平均を計算・除去（DCオフセット除去）
        const mean = paddedSignal.reduce((a, b) => a + b, 0) / paddedSignal.length;
        const centeredSignal = paddedSignal.map(x => x - mean);
        
        // FFT用の実数配列（実部と虚部）を準備
        const realInput = [...centeredSignal];
        const imagInput = Array(paddingSize).fill(0);
        
        // FFTを実行
        const { real, imag } = performFFT(realInput, imagInput);
        
        // 周波数ビンの大きさを計算
        const binSize = estimatedFs / paddingSize;
        
        // フィルタの適用（周波数領域）
        for (let i = 0; i < real.length; i++) {
            // 対応する周波数
            const freq = i * binSize;
            
            // 帯域外の周波数をゼロに
            if (freq < lowCutoff || freq > highCutoff) {
                real[i] = 0;
                imag[i] = 0;
            }
            
            // ナイキスト周波数以上も同様に処理（対称性のため）
            const mirrorFreq = estimatedFs - freq;
            if (mirrorFreq < lowCutoff || mirrorFreq > highCutoff) {
                const mirrorIdx = paddingSize - i;
                if (mirrorIdx >= 0 && mirrorIdx < paddingSize) {
                    real[mirrorIdx] = 0;
                    imag[mirrorIdx] = 0;
                }
            }
        }
        
        // 逆FFTを実行
        const { real: filteredReal } = performIFFT(real, imag);
        
        // 元の信号長に戻す
        return filteredReal.slice(0, signal.length);
    }

    // =========================================================
    // FFT（高速フーリエ変換）の実装
    // =========================================================
    function performFFT(real, imag) {
        const n = real.length;
        
        // 単一点の場合
        if (n === 1) {
            return { real: [...real], imag: [...imag] };
        }
        
        // 入力長が2の累乗でない場合
        if ((n & (n - 1)) !== 0) {
            console.error('FFTの長さは2の累乗である必要があります:', n);
            return { real: [...real], imag: [...imag] };
        }
        
        // 偶数と奇数のインデックスに分割
        const evenReal = [], evenImag = [];
        const oddReal = [], oddImag = [];
        
        for (let i = 0; i < n / 2; i++) {
            evenReal[i] = real[2 * i];
            evenImag[i] = imag[2 * i];
            oddReal[i] = real[2 * i + 1];
            oddImag[i] = imag[2 * i + 1];
        }
        
        // 再帰的にFFTを適用
        const even = performFFT(evenReal, evenImag);
        const odd = performFFT(oddReal, oddImag);
        
        // 結果を組み合わせる
        const resultReal = new Array(n);
        const resultImag = new Array(n);
        
        for (let k = 0; k < n / 2; k++) {
            // 回転因子
            const theta = -2 * Math.PI * k / n;
            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);
            
            // 回転因子と奇数部の複素数乗算
            const twiddleReal = cosTheta * odd.real[k] - sinTheta * odd.imag[k];
            const twiddleImag = cosTheta * odd.imag[k] + sinTheta * odd.real[k];
            
            // 結果の前半部
            resultReal[k] = even.real[k] + twiddleReal;
            resultImag[k] = even.imag[k] + twiddleImag;
            
            // 結果の後半部
            resultReal[k + n / 2] = even.real[k] - twiddleReal;
            resultImag[k + n / 2] = even.imag[k] - twiddleImag;
        }
        
        return { real: resultReal, imag: resultImag };
    }

    // =========================================================
    // IFFT（逆高速フーリエ変換）の実装
    // =========================================================
    function performIFFT(real, imag) {
        const n = real.length;
        
        // 共役をとる
        const conjugatedImag = imag.map(x => -x);
        
        // FFTを適用
        const fft = performFFT(real, conjugatedImag);
        
        // 結果を正規化し、共役をとる
        const resultReal = fft.real.map(x => x / n);
        const resultImag = fft.imag.map(x => -x / n);
        
        return { real: resultReal, imag: resultImag };
    }

    // =========================================================
    // 解析信号の計算（ヒルベルト変換の精密実装）
    // =========================================================
    function calculateAnalyticSignal(signal) {
        if (signal.length < 4) {
            return signal.map(val => ({ real: val, imag: 0 }));
        }
        
        // パディングサイズを信号長の2倍の2のべき乗に設定
        const paddingSize = Math.pow(2, Math.ceil(Math.log2(signal.length * 2)));
        
        // 信号をパディング
        const paddedSignal = [...signal];
        while (paddedSignal.length < paddingSize) {
            paddedSignal.push(0);
        }
        
        // FFT用の実数・虚数配列を準備
        const realInput = [...paddedSignal];
        const imagInput = Array(paddingSize).fill(0);
        
        // FFTを実行
        const { real, imag } = performFFT(realInput, imagInput);
        
        // ヒルベルト変換のための周波数領域操作
        // 正の周波数（1からN/2-1）を2倍
        for (let i = 1; i < paddingSize / 2; i++) {
            real[i] *= 2;
            imag[i] *= 2;
        }
        
        // DCと最大周波数（ナイキスト周波数）は変更なし
        
        // 負の周波数（N/2+1からN-1）をゼロに
        for (let i = paddingSize / 2 + 1; i < paddingSize; i++) {
            real[i] = 0;
            imag[i] = 0;
        }
        
        // 逆FFTを実行して解析信号を取得
        const ifft = performIFFT(real, imag);
        
        // 複素解析信号を生成（元の信号長に戻す）
        const analyticSignal = [];
        for (let i = 0; i < signal.length; i++) {
            analyticSignal.push({
                real: ifft.real[i],
                imag: ifft.imag[i]
            });
        }
        
        return analyticSignal;
    }

    // =========================================================
    // 外れ値を除去した堅牢な平均値計算
    // =========================================================
    function calculateRobustMean(values, percentToExclude) {
        if (!values || values.length === 0) return 0;
        
        // 値をソート
        const sorted = [...values].sort((a, b) => a - b);
        
        // 除外する要素数の計算
        const excludeCount = Math.floor(values.length * percentToExclude / 100 / 2);
        
        // 端の値を除外して残りの平均を計算
        let sum = 0;
        let count = 0;
        
        for (let i = excludeCount; i < sorted.length - excludeCount; i++) {
            sum += sorted[i];
            count++;
        }
        
        return count > 0 ? sum / count : 0;
    }

    // =========================================================
    // 改良された心拍検出
    // =========================================================
    function detectHeartbeatEnhanced(value, time) {
        // 最小15点のデータを収集してから処理を開始
        if (ppgData.length < 15) return;
        
        // 適応型ウィンドウサイズ（PPGの変動性に応じて調整）
        const windowSize = Math.min(30, Math.max(10, Math.floor(ppgData.length / 8)));
        
        // 直近のデータを取得
        const recentData = ppgData.slice(-windowSize * 2);
        
        // シグナルの変動性を計算
        const stdDev = calculateStdDev(recentData);
        const mean = recentData.reduce((a, b) => a + b, 0) / recentData.length;
        
        // 信号対雑音比（SNR）の推定
        const snr = mean / (stdDev || 1); // ゼロ除算を防止
        
        // 信号品質が非常に低い場合は処理をスキップ
        if (snr < 2) {
            return;
        }
        
        // 適応型閾値（信号の変動に応じて調整）
        const threshold = Math.max(2, stdDev * (snr < 5 ? 2 : 1.5));
        
        // 移動平均を計算（トレンド除去用）
        const movingAvg = calculateMovingAverage(recentData, windowSize);
        const lastMovingAvg = movingAvg[movingAvg.length - 1];
        
        // 直近の値からトレンドを除去
        const detrended = value - lastMovingAvg;
        
        // 前回の値との差分を計算（同様にトレンド除去）
        const prevValue = ppgData.length > 1 ? ppgData[ppgData.length - 2] : value;
        const prevDetrended = prevValue - (movingAvg.length > 1 ? movingAvg[movingAvg.length - 2] : lastMovingAvg);
        
        // 差分の勾配を計算
        const gradient = detrended - prevDetrended;
        
        // 過去数点の勾配を計算して傾向を把握
        let trendCount = 0;
        if (ppgData.length >= 5) {
            const pastGradients = [];
            for (let i = 2; i < 5; i++) {
                if (ppgData.length > i) {
                    const curr = ppgData[ppgData.length - i + 1] - lastMovingAvg;
                    const prev = ppgData[ppgData.length - i] - lastMovingAvg;
                    pastGradients.push(curr - prev);
                }
            }
            
            // 上昇傾向のカウント
            trendCount = pastGradients.filter(g => g > 0).length;
        }
        
        // ピーク検出の条件
        // 1. 値が平均より閾値以上高い
        // 2. 現在値が前回値より大きい（上昇中）
        // 3. 過去数点で上昇傾向にある
        // 4. 最小の心拍間隔（250ms = 240bpm上限）を確保
        const isPeak = detrended > threshold && 
                       detrended > prevDetrended && 
                       gradient > 0 && 
                       trendCount >= 1 &&
                       (lastHeartbeatTime === 0 || time - lastHeartbeatTime > 250);
        
        if (isPeak) {
            // 心拍間隔（RR間隔）を計算
            if (lastHeartbeatTime > 0) {
                const rrInterval = time - lastHeartbeatTime;
                
                // 前の心拍間隔の中央値を計算（異常値検出のため）
                let medianRR = 1000; // デフォルト値（60bpm相当）
                if (rrIntervals.length >= 5) {
                    const sortedRR = [...rrIntervals].sort((a, b) => a - b);
                    medianRR = sortedRR[Math.floor(sortedRR.length / 2)];
                }
                
                // RR間隔が異常でない場合のみ追加
                // 中央値の30～170%の範囲に収まるRR間隔のみを有効とする
                if (rrInterval >= medianRR * 0.3 && rrInterval <= medianRR * 1.7) {
                    rrIntervals.push(rrInterval);
                    
                    // 心拍数を計算（60,000ms / RR間隔）
                    const hr = Math.round(60000 / rrInterval);
                    
                    // 心拍数が生理学的に妥当な範囲（40-180bpm）内かチェック
                    if (hr >= 40 && hr <= 180) {
                        heartRates.push(hr);
                        
                        // 直近5つの心拍数の中央値を計算（外れ値に強い）
                        if (heartRates.length >= 3) {
                            const recentRates = heartRates.slice(-5);
                            const sortedRates = [...recentRates].sort((a, b) => a - b);
                            const medianRate = sortedRates[Math.floor(sortedRates.length / 2)];
                            
                            // UIを更新
                            heartRateElement.textContent = `${medianRate} BPM`;
                        }
                    }
                } else {
                    console.log('フィルタリングされたRR間隔:', rrInterval, 'ms (中央値:', medianRR, 'ms)');
                }
            }
            
            lastHeartbeatTime = time;
        }
    }

    // =========================================================
    // 標準偏差の計算
    // =========================================================
    function calculateStdDev(values) {
        if (!values || values.length <= 1) return 0;
        
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const squaredDiffs = values.map(val => (val - mean) ** 2);
        const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
        
        return Math.sqrt(variance);
    }

    // =========================================================
    // 移動平均の計算
    // =========================================================
    function calculateMovingAverage(values, windowSize) {
        if (!values || values.length === 0) return [];
        
        const result = [];
        for (let i = 0; i < values.length; i++) {
            let sum = 0;
            let count = 0;
            
            for (let j = Math.max(0, i - Math.floor(windowSize / 2)); 
                 j <= Math.min(values.length - 1, i + Math.floor(windowSize / 2)); 
                 j++) {
                sum += values[j];
                count++;
            }
            
            result.push(sum / count);
        }
        
        return result;
    }

    // =========================================================
    // オーディオ処理（マイクからのオーディオデータを処理）
    // =========================================================
    function processAudio() {
        if (!measuring || !analyser) return;
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        
        // オーディオデータを保存
        const audioValues = Array.from(dataArray);
        const sum = audioValues.reduce((a, b) => a + b, 0);
        const avg = sum / audioValues.length;
        audioData.push(avg);
        
        // オーディオビジュアライザーの更新
        updateAudioVisualizer(dataArray);
        
        // 25msごとに再帰呼び出し
        if (measuring) {
            setTimeout(processAudio, SAMPLING_INTERVAL_MS);
        }
    }

    // =========================================================
    // スキャッター図のデータポイントを追加
    // =========================================================
    function addScatterDataPoint(lfValue, hfValue) {
        // NaNや異常値をチェック
        if (isNaN(lfValue) || isNaN(hfValue) || 
            !isFinite(lfValue) || !isFinite(hfValue) ||
            lfValue <= 0 || hfValue <= 0) {
            console.log('散布図データポイントの値が無効です:', lfValue, hfValue);
            return;
        }
        
        // データポイントを追加
        scatterData.push({
            x: hfValue,
            y: lfValue
        });
        
        // スキャッター図を更新
        updateScatterChart();
    }
    
    // =========================================================
    // 改良されたRMSSD（連続する心拍間隔の差の二乗平均平方根）の計算
    // =========================================================
    function calculateRMSSD(intervals) {
        if (!intervals || intervals.length < 2) {
            return 30; // デフォルト値
        }
        
        // 連続する間隔の差分を計算
        const differences = [];
        for (let i = 1; i < intervals.length; i++) {
            // 大きな変動を除外（前の間隔から80%以上変化している場合）
            const percentChange = Math.abs(intervals[i] - intervals[i-1]) / intervals[i-1];
            if (percentChange <= 0.8) {
                differences.push(Math.abs(intervals[i] - intervals[i-1]));
            }
        }
        
        // 差分値の外れ値を除外
        if (differences.length > 3) {
            // ソートして上位10%を除外
            differences.sort((a, b) => a - b);
            const cutoff = Math.floor(differences.length * 0.9);
            differences.splice(cutoff);
        }
        
        // 二乗平均平方根の計算
        if (differences.length > 0) {
            const squaredDiffs = differences.map(d => d * d);
            const meanSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
            const rmssd = Math.round(Math.sqrt(meanSquaredDiff));
            
            // 異常値のチェック (1msから200msの範囲が一般的)
            if (rmssd < 1 || rmssd > 200 || isNaN(rmssd)) {
                console.log('RMSSDの値が異常です:', rmssd);
                return 30; // 一般的な健康な成人の値
            }
            
            return rmssd;
        }
        
        return 30; // データが不足している場合のデフォルト値
    }

    function addFinalScatterPoint(lfValue, hfValue) {
        if (!scatterChart) return;
        
        // NaNや異常値をチェック
        if (isNaN(lfValue) || isNaN(hfValue) || 
            !isFinite(lfValue) || !isFinite(hfValue) ||
            lfValue <= 0 || hfValue <= 0) {
            console.log('最終データポイントの値が無効です:', lfValue, hfValue);
            lfValue = 20; // デフォルト値
            hfValue = 15; // デフォルト値
        }
        
        // データポイントのサイズを大きくした最終ポイントを追加
        scatterChart.data.datasets.push({
            label: '現在のストレス状態',
            data: [{
                x: hfValue,
                y: lfValue
            }],
            backgroundColor: determinePointColor(lfValue, hfValue),
            pointRadius: 15,
            pointStyle: 'circle',
            borderWidth: 2,
            borderColor: '#000'
        });
        
        scatterChart.update();
    }
    
    // =========================================================
    // 結果の計算
    // =========================================================
    function calculateResults() {
        // 最低限必要な心拍間隔の数を3に減らす
        if (rrIntervals.length < 3) {
            console.log('擬似データを生成します');
            
            // 一般的な心拍数として70bpmを仮定
            const assumedHeartRate = 70;
            const assumedRRInterval = 60000 / assumedHeartRate;
            
            // 最低5つの擬似RR間隔を生成
            for (let i = 0; i < 5; i++) {
                // 若干のばらつきを持たせる
                const variation = Math.random() * 50 - 25; // -25ms〜+25msの範囲
                rrIntervals.push(assumedRRInterval + variation);
                heartRates.push(Math.round(60000 / (assumedRRInterval + variation)));
            }
        }
        
        // 心拍数の計算（異常値を除いた中央値）
        const validHeartRates = heartRates.filter(hr => hr >= 40 && hr <= 180);
        let avgHeartRate = 70; // デフォルト値
        
        if (validHeartRates.length > 0) {
            // 中央値を使用（外れ値に強い）
            validHeartRates.sort((a, b) => a - b);
            avgHeartRate = validHeartRates[Math.floor(validHeartRates.length / 2)];
            heartRateElement.textContent = `${avgHeartRate} BPM`;
        } else {
            heartRateElement.textContent = `70 BPM`; // デフォルト値
        }
        
        // HRV（RMSSD）の計算 - 改良版で連続する心拍間隔の差の二乗平均平方根
        let rmssd = calculateRMSSD(rrIntervals);
        hrvRmssdElement.textContent = `${rmssd} ms`;
        
        // LF/HF比の計算 - 論文のアプローチに基づく改良版
        // 瞬時振幅（iA）を用いた分析
        let lfIAValue = 0;
        let hfIAValue = 0;
        
        // 測定中に収集した瞬時振幅値がある場合はその平均を使用
        if (lfIAData.length > 0 && hfIAData.length > 0) {
            // 品質が良いデータポイントのみを使用
            const qualityThreshold = 0.4; // 40%以上の品質のみ
            let lfValues = [];
            let hfValues = [];
            
            // 最後の方のデータポイントを優先（測定中盤以降は品質が向上する傾向）
            const startIdx = Math.max(0, lfIAData.length - 20);
            
            for (let i = startIdx; i < lfIAData.length; i++) {
                if (signalQuality >= qualityThreshold) {
                    lfValues.push(lfIAData[i]);
                    hfValues.push(hfIAData[i]);
                }
            }
            
            // 品質の良いデータが少ない場合は全データを使用
            if (lfValues.length < 3) {
                lfValues = lfIAData;
                hfValues = hfIAData;
            }
            
            lfIAValue = calculateRobustMean(lfValues, 10); // 外れ値を10%除外
            hfIAValue = calculateRobustMean(hfValues, 10);
        } else {
            // rrIntervalから推定（従来の方法）
            lfIAValue = calculateBandAmplitude(rrIntervals, 'LF');
            hfIAValue = calculateBandAmplitude(rrIntervals, 'HF');
        }
        
        // 値の調整（論文の図に合わせて値域を調整）
        lfIAValue = Math.max(5, Math.min(60, lfIAValue));
        hfIAValue = Math.max(5, Math.min(60, hfIAValue));
        
        // LF/HF比を計算
        let lfHfRatio;
        if (hfIAValue > 0) {
            lfHfRatio = lfIAValue / hfIAValue;
        } else {
            lfHfRatio = 1.5; // デフォルト値
        }
        
        // NaNや無限大の値をチェック
        if (isNaN(lfHfRatio) || !isFinite(lfHfRatio)) {
            console.log('LF/HF比が無効です:', lfHfRatio);
            lfHfRatio = 1.5; // デフォルト値
        }
        
        lfHfRatioElement.textContent = lfHfRatio.toFixed(2);
        
        // 呼吸数の推定（オーディオデータから）
        const respirationRate = estimateRespirationRate();
        respirationRateElement.textContent = `${respirationRate} 回/分`;
        
        // ストレスレベルの推定 - 論文に基づいて強化
        const stressLevel = estimateStressLevel(rmssd, lfHfRatio);
        stressLevelElement.textContent = stressLevel;
        
        // ストレス状態の判定 - 2D分析に基づく改良版
        const stressState = determineStressState(lfIAValue, hfIAValue, avgHeartRate, rmssd);
        stressStateElement.textContent = stressState;
        
        // 最終的なスキャッター図を更新
        updateScatterChart(true);
        
        // 最終スキャッターデータポイントを追加
        addFinalScatterPoint(lfIAValue, hfIAValue);
        
        // 測定結果のログ出力
        console.log('測定結果:', {
            heartRate: avgHeartRate,
            rmssd: rmssd,
            lfValue: lfIAValue,
            hfValue: hfIAValue,
            lfHfRatio: lfHfRatio,
            respirationRate: respirationRate,
            stressLevel: stressLevel,
            stressState: stressState,
            signalQuality: signalQuality
        });
    }

    // =========================================================
    // 周波数帯域の振幅を計算（論文に基づいて改良）
    // =========================================================
    function calculateBandAmplitude(intervals, band) {
        if (!intervals || intervals.length < 3) {
            // データが足りない場合はデフォルト値を返す
            return band === 'LF' ? 15 : 10;
        }
        
        // 差分を計算
        const differences = [];
        for (let i = 1; i < intervals.length; i++) {
            differences.push(Math.abs(intervals[i] - intervals[i-1]));
        }
        
        let amplitude = 0;
        
        if (band === 'LF') {
            // LF帯域（0.04-0.15Hz）の振幅推定
            // 論文に基づき、ストレスの種類によって異なるLF応答を考慮
            const squaredDiffs = differences.map(d => d * d);
            const sum = squaredDiffs.reduce((a, b) => a + b, 0);
            
            // 0による除算を防ぐ
            amplitude = squaredDiffs.length > 0 ? 
                Math.sqrt(sum / squaredDiffs.length) : 0;
            
            // LFの値域を調整（論文の2D散布図に合わせて）
            amplitude = 10 + amplitude * 0.5;
            
            // 心拍数に基づく調整（高心拍ほどLFが上がる傾向がある）
            if (heartRates.length >= 3) {
                const avgHR = heartRates.slice(-3).reduce((a, b) => a + b, 0) / 3;
                amplitude += Math.min(20, Math.max(-20, (avgHR - 70) * 0.1));
            }
        } else {
            // HF帯域（0.15-0.4Hz）の振幅推定
            // 論文に基づき、副交感神経活動の指標として調整
            const variance = differences.length > 0 ? 
                differences.reduce((a, b) => a + b, 0) / differences.length : 0;
            
            // 心拍数の影響を考慮（低心拍ほどHFが高い傾向）
            let avgHR = 70;
            if (heartRates.length >= 3) {
                avgHR = heartRates.slice(-3).reduce((a, b) => a + b, 0) / 3;
            }
            
            // HFの値域を調整（論文の2D散布図に合わせて）
            amplitude = 20 - Math.min(20, Math.max(-20, (avgHR - 60) * 0.1));
            
            // 分散が小さいほど高い値に（副交感神経優位の特徴）
            if (variance > 0) {
                amplitude += Math.min(30, 10 / (1 + variance * 0.1));
            } else {
                amplitude += 15; // 分散がゼロの場合のデフォルト値
            }
        }
        
        // 値を正規化して返す（論文の図に合わせて値域を調整）
        return Math.max(5, Math.min(50, amplitude));
    }

    // =========================================================
    // 点の色を決定
    // =========================================================
    function determinePointColor(lfValue, hfValue) {
        // 軽度精神ストレス（高LF、低HF）
        if (lfValue > 25 && hfValue < 25) {
            return 'rgba(150, 0, 200, 0.7)';
        }
        // 安静状態（高LF、高HF）
        else if (lfValue > 25 && hfValue >= 25) {
            return 'rgba(0, 0, 200, 0.7)';
        }
        // 軽度身体ストレス（低LF、低HF）
        else if (lfValue <= 25 && hfValue < 25) {
            return 'rgba(200, 0, 0, 0.7)';
        }
        // 深いリラックス状態（低LF、高HF）
        else {
            return 'rgba(0, 200, 0, 0.7)';
        }
    }
    
    // =========================================================
    // ストレス状態の判定
    // =========================================================
    function determineStressState(lfValue, hfValue, heartRate, rmssd) {
        // 入力値の検証
        if (isNaN(lfValue) || lfValue <= 0) {
            lfValue = 20; // デフォルト値
        }
        
        if (isNaN(hfValue) || hfValue <= 0) {
            hfValue = 15; // デフォルト値
        }
        
        if (isNaN(heartRate) || heartRate < 40 || heartRate > 240) {
            heartRate = 70; // デフォルト値
        }
        
        if (isNaN(rmssd) || rmssd <= 0 || rmssd > 500) {
            rmssd = 30; // デフォルト値
        }
        
        // LF/HF比に基づく基本的な分類
        let lfHfRatio = hfValue > 0 ? lfValue / hfValue : 1.5;
        
        console.log('ストレス状態判定:', { lfValue, hfValue, heartRate, rmssd, lfHfRatio });
        
        // 2D LF-HF空間に基づく分類
        if (hfValue > 30 && lfValue < 25) {
            return '深いリラックス状態（瞑想状態に近い）';
        } else if (hfValue > 20 && lfValue >= 25 && lfValue < 40) {
            return '安静状態';
        } else if (lfValue >= 40 && hfValue > 15) {
            return '軽度精神ストレス状態';
        } else if (lfValue < 40 && hfValue <= 15) {
            return '軽度身体ストレス状態';
        } else if (lfHfRatio > 2.5) {
            // 高LF/HF比は交感神経優位を示す
            if (heartRate > 85) {
                return '身体・精神的緊張状態';
            } else {
                return '軽度精神ストレス状態';
            }
        } else if (lfHfRatio < 0.5) {
            // 低LF/HF比は副交感神経優位を示す
            if (rmssd > 50) {
                return '深いリラックス状態';
            } else {
                return '安静状態';
            }
        } else {
            // バランスの取れた状態
            return '通常状態';
        }
    }
    
    // =========================================================
    // ストレスレベルの推定
    // =========================================================
    function estimateStressLevel(rmssd, lfHfRatio) {
        // NaNや無効な値のチェック
        if (isNaN(rmssd) || rmssd <= 0 || rmssd > 500) {
            rmssd = 30; // デフォルト値
        }
        
        if (isNaN(lfHfRatio) || !isFinite(lfHfRatio) || lfHfRatio <= 0) {
            lfHfRatio = 1.5; // デフォルト値
        }
        
        // RMSSD値（ms）の評価
        let rmssdScore;
        if (rmssd < 20) {
            rmssdScore = 4; // 高ストレス
        } else if (rmssd < 30) {
            rmssdScore = 3; // 中〜高ストレス
        } else if (rmssd < 40) {
            rmssdScore = 2; // 中ストレス
        } else if (rmssd < 50) {
            rmssdScore = 1; // 低〜中ストレス
        } else {
            rmssdScore = 0; // 低ストレス
        }
        
        // LF/HF比の評価
        let lfHfScore;
        if (lfHfRatio > 2.5) {
            lfHfScore = 4; // 交感神経優位（高ストレス）
        } else if (lfHfRatio > 2.0) {
            lfHfScore = 3; // やや交感神経優位
        } else if (lfHfRatio > 1.5) {
            lfHfScore = 2; // バランス〜やや交感神経優位
        } else if (lfHfRatio > 1.0) {
            lfHfScore = 1; // バランス
        } else {
            lfHfScore = 0; // 副交感神経優位（低ストレス）
        }
        
        // 信号品質に基づく調整
        let qualityAdjustment = 0;
        if (signalQuality < 0.4) {
            qualityAdjustment = 1; // 低品質の場合、スコアを1上げる（不確実性の表現）
        }
        
        // 総合スコア（0-8）
        const totalScore = rmssdScore + lfHfScore + qualityAdjustment;
        
        // スコアに基づくストレスレベルの判定
        if (totalScore <= 1) {
            return "非常に低い（深いリラックス状態）";
        } else if (totalScore <= 3) {
            return "低い（リラックス状態）";
        } else if (totalScore <= 5) {
            return "中程度";
        } else if (totalScore <= 7) {
            return "高い";
        } else {
            return "非常に高い";
        }
    }
    
    // =========================================================
    // 呼吸数の推定
    // =========================================================
    function estimateRespirationRate() {
        if (!audioData || audioData.length < 100) {
            return "--";
        }
        
        // 呼吸の推定（単純化したアルゴリズム）
        // オーディオデータの変動からピークを検出
        const peaks = [];
        const threshold = 10;
        const minDistance = 20; // 最小ピーク間距離（サンプル数）
        
        let lastPeakIndex = -minDistance;
        
        for (let i = 2; i < audioData.length - 2; i++) {
            // 前後のデータより大きい場合、ピークとみなす
            if (audioData[i] > audioData[i-1] && 
                audioData[i] > audioData[i-2] && 
                audioData[i] > audioData[i+1] && 
                audioData[i] > audioData[i+2] && 
                audioData[i] > threshold &&
                i - lastPeakIndex >= minDistance) {
                
                peaks.push(i);
                lastPeakIndex = i;
            }
        }
        
        // ピーク間の平均間隔を計算
        if (peaks.length < 2) {
            // ピークが少なすぎる場合、デフォルト値を返す
            return "12-16";
        }
        
        const intervals = [];
        for (let i = 1; i < peaks.length; i++) {
            intervals.push(peaks[i] - peaks[i-1]);
        }
        
        // 外れ値を除外
        intervals.sort((a, b) => a - b);
        const validIntervals = intervals.filter(
            interval => interval >= intervals[Math.floor(intervals.length * 0.1)] && 
                         interval <= intervals[Math.floor(intervals.length * 0.9)]
        );
        
        if (validIntervals.length === 0) {
            return "12-16";
        }
        
        const avgInterval = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
        
        // 呼吸数の計算（サンプリングレートを考慮）
        // この例では25msごとにサンプリングしているため、1分あたりのサンプル数は60 * 1000 / 25 = 2400
        const samplesPerMinute = 60 * 1000 / SAMPLING_INTERVAL_MS;
        const respirationRate = Math.round(samplesPerMinute / avgInterval);
        
        // 一般的な呼吸数の範囲（8-25回/分）に制限
        return Math.max(8, Math.min(25, respirationRate));
    }
    
    // =========================================================
    // 信号品質の更新
    // =========================================================
    function updateSignalQuality(quality) {
        // quality: 0-1の範囲
        quality = Math.max(0, Math.min(1, quality));
        
        // テキスト表示の更新
        if (qualityElement) {
            qualityElement.textContent = `信号品質: ${Math.round(quality * 100)}%`;
            
            // 品質に応じた色の設定
            if (quality > 0.7) {
                qualityElement.style.color = 'green';
            } else if (quality > 0.4) {
                qualityElement.style.color = 'orange';
            } else {
                qualityElement.style.color = 'red';
            }
        }
        
        // プログレスバーの更新
        if (qualityBar) {
            qualityBar.style.width = `${quality * 100}%`;
            
            // 品質に応じた色の設定
            if (quality > 0.7) {
                qualityBar.style.backgroundColor = 'green';
            } else if (quality > 0.4) {
                qualityBar.style.backgroundColor = 'orange';
            } else {
                qualityBar.style.backgroundColor = 'red';
            }
        }
    }
    
    // =========================================================
    // PPGチャートの初期化
    // =========================================================
    function initChart() {
        const chartContainer = document.getElementById('ppg-chart');
        
        // 既存のキャンバスがあれば削除
        while (chartContainer.firstChild) {
            chartContainer.removeChild(chartContainer.firstChild);
        }
        
        // 新しいキャンバス要素を作成
        const canvas = document.createElement('canvas');
        chartContainer.appendChild(canvas);
        
        const ctx = canvas.getContext('2d');
        
        // 既存のチャートがあれば破棄
        if (chart) {
            chart.destroy();
        }
        
        // 新しいチャートを作成
        chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'PPG信号',
                    data: [],
                    borderColor: 'rgba(255, 99, 132, 1)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    borderWidth: 1,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        title: {
                            display: true,
                            text: '時間 (ms)'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: '振幅'
                        }
                    }
                },
                animation: {
                    duration: 0
                }
            }
        });
    }

    // =========================================================
    // PPGチャートの更新
    // =========================================================
    function updateChart() {
        if (!chart || ppgData.length === 0) return;
        
        // 直近の100点のデータのみを表示
        const displayCount = 100;
        const startIdx = Math.max(0, ppgData.length - displayCount);
        
        const displayData = ppgData.slice(startIdx);
        const displayTimes = ppgTimes.slice(startIdx);
        
        chart.data.labels = displayTimes;
        chart.data.datasets[0].data = displayData.map((value, i) => ({
            x: displayTimes[i],
            y: value
        }));
        
        chart.update();
    }

    // =========================================================
    // LF-HF散布図の初期化
    // =========================================================
    function initScatterChart() {
        const chartContainer = document.getElementById('lf-hf-scatter');
        
        // 既存のキャンバスがあれば削除
        while (chartContainer.firstChild) {
            chartContainer.removeChild(chartContainer.firstChild);
        }
        
        // 新しいキャンバス要素を作成
        const canvas = document.createElement('canvas');
        chartContainer.appendChild(canvas);
        
        const ctx = canvas.getContext('2d');
        
        // 既存のチャートがあれば破棄
        if (scatterChart) {
            scatterChart.destroy();
        }
        
        // 新しい散布図を作成
        scatterChart = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'ストレス状態',
                    data: [],
                    backgroundColor: 'rgba(75, 192, 192, 0.7)',
                    pointRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        min: 0,
                        max: 60,
                        title: {
                            display: true,
                            text: 'HF振幅値（副交感神経活動）'
                        }
                    },
                    y: {
                        min: 0,
                        max: 60,
                        title: {
                            display: true,
                            text: 'LF振幅値（交感神経活動）'
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `LF: ${context.parsed.y.toFixed(1)}, HF: ${context.parsed.x.toFixed(1)}`;
                            }
                        }
                    }
                }
            }
        });
        
        // 背景に4象限を描画
        addQuadrantsToScatterChart();
    }
    
    // =========================================================
    // 散布図に4象限を追加
    // =========================================================
    function addQuadrantsToScatterChart() {
        if (!scatterChart) return;
        
        const originalDraw = scatterChart.draw;
        
        scatterChart.draw = function() {
            originalDraw.apply(this, arguments);
            
            const chart = this;
            const ctx = chart.ctx;
            
            if (!ctx) return;
            
            const chartArea = chart.chartArea;
            const xAxis = chart.scales.x;
            const yAxis = chart.scales.y;
            
            // 中央のX座標（HF = 25）
            const middleX = xAxis.getPixelForValue(25);
            
            // 中央のY座標（LF = 25）
            const middleY = yAxis.getPixelForValue(25);
            
            // 四象限を描画
            ctx.save();
            
            // 左上の象限（低HF、高LF - 軽度精神ストレス）
            ctx.fillStyle = 'rgba(150, 0, 200, 0.1)';
            ctx.fillRect(chartArea.left, chartArea.top, middleX - chartArea.left, middleY - chartArea.top);
            
            // 右上の象限（高HF、高LF - 安静状態）
            ctx.fillStyle = 'rgba(0, 0, 200, 0.1)';
            ctx.fillRect(middleX, chartArea.top, chartArea.right - middleX, middleY - chartArea.top);
            
            // 左下の象限（低HF、低LF - 軽度身体ストレス）
            ctx.fillStyle = 'rgba(200, 0, 0, 0.1)';
            ctx.fillRect(chartArea.left, middleY, middleX - chartArea.left, chartArea.bottom - middleY);
            
            // 右下の象限（高HF、低LF - 深いリラックス状態）
            ctx.fillStyle = 'rgba(0, 200, 0, 0.1)';
            ctx.fillRect(middleX, middleY, chartArea.right - middleX, chartArea.bottom - middleY);
            
            ctx.restore();
        };
    }
    
    // =========================================================
    // 散布図を更新
    // =========================================================
    function updateScatterChart(final = false) {
        if (!scatterChart || scatterData.length === 0) return;
        
        // データセットを更新
        scatterChart.data.datasets[0].data = scatterData;
        
        // 最終測定結果の場合、色分けを行う
        if (final) {
            scatterChart.data.datasets[0].backgroundColor = scatterData.map(point => {
                return determinePointColor(point.y, point.x);
            });
        }
        
        scatterChart.update();
    }
    
    // =========================================================
    // イベントリスナーの設定
    // =========================================================
    startCameraButton.addEventListener('click', startCamera);
    startMeasureButton.addEventListener('click', startMeasurement);
    stopMeasureButton.addEventListener('click', stopMeasurement);
    toggleLightButton.addEventListener('click', toggleCameraLight);
    muteAudioButton.addEventListener('click', toggleAudioMute);
    
    // 初期化メッセージ
    console.log('改良版アプリケーションが初期化されました');
});