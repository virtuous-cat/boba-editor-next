// TODO: whitelist origins for which this is allowed, as it's a very dangerous operation.
export const maybeAttachScriptTagtoDom = (html: string) => {
  // Some embeds only work if we allow the associated script tag to be loaded after
  // their content is appended to the DOM, so we extract the tag and manually run it.
  // We cannot do this with the article ref itself because dangerouslySetInnerHTML
  // removes script tags (as does setting innerHTML).
  const fragment = document.createRange().createContextualFragment(html);
  const scriptTag = fragment?.querySelector("script");
  if (scriptTag) {
    document.body.appendChild(scriptTag);
  }
};

const getIframeWithinMutations = (mutationRecords: MutationRecord[]) => {
  const withAddedNodes = mutationRecords.filter(
    (mutation) => mutation.addedNodes.length > 0
  );
  for (let mutation of withAddedNodes) {
    for (let addedNode of Array.from<HTMLElement>(mutation.addedNodes as any)) {
      if (addedNode.nodeName == "IFRAME") {
        return addedNode;
      }
      const iframeChild = addedNode.querySelector("iframe");
      if (iframeChild) {
        return iframeChild;
      }
    }
  }
  return null;
};

const attachMutationObserver = (rootNode: HTMLElement, onLoad: () => void) => {
  // TODO: maybe disconnect after a while if none of this has happened
  const observer = new MutationObserver((mutations, observer) => {
    const potentialIframe = getIframeWithinMutations(mutations);
    if (!potentialIframe) {
      return;
    }
    observer.disconnect();
    // This is the current height of the iframe before any loading happens
    const currentHeight = potentialIframe.getBoundingClientRect().height;
    // We periodically check for a change in height. When height changes, we determine that
    // the iframe has been loaded.
    let MAX_ATTEMPTS = 10;
    setTimeout(function checkNewHeight() {
      const newCurrentHeight = potentialIframe.getBoundingClientRect().height;
      if (currentHeight != newCurrentHeight) {
        // The iframe has loaded!
        onLoad();
        return;
      }
      // Let's try listening again in a little bit, unless we're out of attempts.
      if (MAX_ATTEMPTS-- > 0) {
        setTimeout(checkNewHeight, 100);
      } else {
        throw new Error(
          "Reached maximum amount of attempts to check iframe resize."
        );
      }
    }, 100);
  });
  observer.observe(rootNode, {
    subtree: true,
    childList: true,
  });
  return observer;
};

const listenForSize = () => {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      console.log(event);
      switch (event.origin) {
        case "https://embed.tumblr.com":
          if (event.data.height) {
            window.removeEventListener("message", listener);
          }
          return resolve(event.data.height);
        default:
          return;
      }
    };
    window.addEventListener("message", listener);
  });
};

// With iframes (and some other embed types that swap regular HTML for iframes), it usually
// takes a while before the embed content is loaded. We listen to changes to the embed with
// an observer to determine when the content loading has finished.
export const listenForResize = async (rootNode: HTMLElement): Promise<void> => {
  return new Promise((resolve) => {
    const observer = attachMutationObserver(rootNode, () => {
      console.log("resize observed!");
      observer.disconnect();
      resolve();
    });
    // TODO: this could be done globally at initialization and we could figure out a way
    // to pass the event down here.
    const iframe = rootNode.querySelector("iframe");
    if (iframe) {
      iframe.onload = async () => {
        observer.disconnect();
        // check and do this only for tumblr
        const newHeight = await listenForSize();
        iframe.style.height = newHeight + "px";
      };
    }
  });
};
