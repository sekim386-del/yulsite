(function () {
  'use strict';

  var state = {
    channels: null,     // 마지막으로 생성된 4채널 결과
    imageDataUrl: null, // 업로드한 이미지의 base64 데이터
    imageHostedUrl: null // Cloudinary에 업로드 완료된 이미지 URL(캐시)
  };

  function $(sel) { return document.querySelector(sel); }

  function populateSelect(selectEl, options) {
    selectEl.innerHTML = '';
    options.forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      selectEl.appendChild(o);
    });
  }

  function init() {
    populateSelect($('#contentType'), (window.CONTENT_TYPES || []));
    populateSelect($('#targetBrand'), (window.TARGET_BRANDS || []));

    $('#imageFile').addEventListener('change', onImageSelected);
    $('#content-form').addEventListener('submit', onGenerate);

    document.querySelectorAll('.publish-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { onPublish(btn.dataset.channel, btn); });
    });
    document.querySelectorAll('.copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { onCopy(btn.dataset.channel, btn); });
    });
  }

  function onImageSelected(e) {
    var file = e.target.files[0];
    state.imageHostedUrl = null; // 이미지가 바뀌면 이전에 업로드했던 URL 캐시 무효화
    if (!file) { state.imageDataUrl = null; return; }
    var reader = new FileReader();
    reader.onload = function () { state.imageDataUrl = reader.result; };
    reader.readAsDataURL(file);
  }

  function setStatus(msg, isError) {
    var el = $('#generate-status');
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  async function onGenerate(e) {
    e.preventDefault();
    var btn = $('#generate-btn');
    var payload = {
      contentType: $('#contentType').value,
      targetBrand: $('#targetBrand').value,
      coreMessage: $('#coreMessage').value.trim(),
      productUrl: $('#productUrl').value.trim() || undefined
    };

    if (!payload.coreMessage) {
      setStatus('핵심 메시지를 입력해주세요.', true);
      return;
    }

    btn.disabled = true;
    setStatus('생성 중입니다...');

    try {
      var res = await fetch('/.netlify/functions/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json();

      if (!res.ok || !data.ok) {
        setStatus(describeError(data), true);
        return;
      }

      state.channels = data.channels;
      renderResults(data.channels);
      setStatus('생성 완료. 내용을 확인한 뒤 발행/복사하세요.');
    } catch (err) {
      setStatus('요청 중 오류가 발생했습니다: ' + err, true);
    } finally {
      btn.disabled = false;
    }
  }

  function describeError(data) {
    if (data && data.error === 'not_configured') {
      return '아직 설정되지 않은 항목이 있습니다: ' + (data.missingEnvVars || []).join(', ');
    }
    return '생성 중 오류가 발생했습니다' + (data && data.error ? ' (' + data.error + ')' : '');
  }

  function renderResults(channels) {
    renderCard('instagram', formatShort(channels.instagram));
    renderCard('threads', formatShort(channels.threads));
    renderCard('naverBlog', formatLong(channels.naverBlog));
    renderCard('fridgeMagazine', formatLong(channels.fridgeMagazine));

    document.querySelectorAll('.publish-btn, .copy-btn').forEach(function (btn) {
      btn.disabled = false;
    });
  }

  function formatShort(c) {
    if (!c) return '';
    var hashtags = (c.hashtags || []).join(' ');
    return c.caption + (hashtags ? '\n\n' + hashtags : '');
  }

  function formatLong(c) {
    if (!c) return '';
    return (c.title ? c.title + '\n\n' : '') + (c.body || '');
  }

  function renderCard(channel, text) {
    var card = document.querySelector('.channel-card[data-channel="' + channel + '"] .channel-body');
    card.textContent = text || '(생성된 내용이 없습니다)';
  }

  function getChannelText(channel) {
    var card = document.querySelector('.channel-card[data-channel="' + channel + '"] .channel-body');
    return card ? card.textContent : '';
  }

  async function ensureImageHosted() {
    if (state.imageHostedUrl) return state.imageHostedUrl;
    if (!state.imageDataUrl) throw new Error('먼저 이미지를 업로드해주세요.');

    var res = await fetch('/.netlify/functions/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: state.imageDataUrl })
    });
    var data = await res.json();
    if (!res.ok || !data.ok) throw new Error(describeError(data));

    state.imageHostedUrl = data.url;
    return data.url;
  }

  async function onPublish(channel, btn) {
    var endpoint = channel === 'instagram' ? '/.netlify/functions/post-instagram'
      : channel === 'threads' ? '/.netlify/functions/post-threads'
      : null;
    if (!endpoint) return;

    btn.disabled = true;
    var originalLabel = btn.textContent;
    btn.textContent = '발행 중...';

    try {
      var imageUrl = await ensureImageHosted();
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: imageUrl, caption: getChannelText(channel) })
      });
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error(describeError(data));

      btn.textContent = '발행 완료';
    } catch (err) {
      alert('발행 실패: ' + err.message);
      btn.textContent = originalLabel;
      btn.disabled = false;
    }
  }

  async function onCopy(channel, btn) {
    var text = getChannelText(channel);
    try {
      await navigator.clipboard.writeText(text);
      var original = btn.textContent;
      btn.textContent = '복사됨';
      setTimeout(function () { btn.textContent = original; }, 1500);
    } catch (err) {
      alert('복사에 실패했습니다. 내용을 직접 선택해 복사해주세요.');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
