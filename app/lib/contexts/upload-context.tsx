import { useState, createContext, useContext, ReactNode } from "react";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon
} from "@heroicons/react/24/solid";

import { useSelf } from "./self-context";
import type {
  UploadWorkerMessage,
  UploadWorkerMessageUpdate,
  UploadWorkerMessageError,
  UploadWorkerMessageSuccess
} from "../workers/upload-worker";

type EnqueueUploadFunctionArgs = {
  id: string;
  file: File;
  albumId: string;
  onUpdate?: (message: UploadWorkerMessageUpdate) => void;
  onError?: (message: UploadWorkerMessageError) => void;
  onSuccess?: (message: UploadWorkerMessageSuccess) => void;
};

type UploadContextType = {
  enqueueUpload: (arg: EnqueueUploadFunctionArgs) => void;
};
type UploadItem = {
  file: File;
  albumId: string;
  state: UploadWorkerMessage["state"];
  error?: string;
};

const UploadContext = createContext<UploadContextType>({} as UploadContextType);

export const useUpload = () => useContext(UploadContext);

export function UploadContextProvider({ children }: { children: ReactNode }) {
  const user = useSelf();
  const [uploads, setUploads] = useState<Map<string, UploadItem>>(new Map());

  const enqueueUpload = (args: EnqueueUploadFunctionArgs) => {
    const { id, file, albumId } = args;
    setUploads((uploads) => {
      if (uploads.has(id)) {
        return uploads;
      }
      uploads.set(id, {
        file,
        albumId,
        state: "pending"
      });

      return new Map(uploads);
    });

    // TODO: Cache this worker code
    const worker = new Worker("/workers/upload-worker.js", { type: "module" });
    worker.postMessage({
      id,
      albumId,
      userId: user.id,
      file
    });
    worker.onmessage = (event) => {
      const data = event.data as UploadWorkerMessage;
      if (data.state === "error" && args.onError) {
        args.onError(data);
      }

      if (data.state === "done" && args.onSuccess) {
        args.onSuccess(data);
      }

      if (data.state !== "done" && data.state !== "error" && args.onUpdate) {
        args.onUpdate(data);
      }

      setUploads((uploads) => {
        const upload = uploads.get(id);
        if (!upload) {
          return uploads;
        }

        uploads.set(id, {
          ...upload,
          state: data.state
        });

        return new Map(uploads);
      });
    };
  };

  return (
    <UploadContext.Provider value={{ enqueueUpload }}>
      {children}
      {uploads.size > 0 && (
        <div className="fixed z-50 bottom-0 md:left-auto left-0 right-0 md:max-w-sm w-screen">
          <div className="p-4 border bg-white max-h-[300px] overflow-scroll border-gray-300 rounded-t-xl">
            {[...uploads.entries()].map(([id, upload]) => {
              const url = URL.createObjectURL(upload.file);
              return (
                <div
                  key={id}
                  className="flex justify-between items-center border-b pb-2 mb-2"
                >
                  <div className="flex gap-2 items-center">
                    {upload.state !== "done" && upload.state !== "error" && (
                      <svg
                        className="animate-spin h-6 w-6 text-primary"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          stroke-width="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                    )}
                    {upload.state === "done" && (
                      <CheckCircleIcon className="w-6 h-6 text-primary" />
                    )}
                    {upload.state === "error" && (
                      <ExclamationTriangleIcon className="w-6 h-6 text-red-500" />
                    )}
                    <div className="text-sm text-gray-500">
                      {upload.file.name}
                      {/* <span className="inline-flex items-center ml-2 rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">
                        {upload.state}
                      </span> */}
                    </div>
                  </div>

                  <div>
                    <img
                      className="w-8 h-8 object-cover"
                      src={url}
                      alt={upload.file.name}
                      onLoad={() => {
                        URL.revokeObjectURL(url);
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </UploadContext.Provider>
  );
}
